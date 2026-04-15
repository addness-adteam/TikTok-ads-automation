/**
 * AI導線 CR別 消化/CV/CPA一覧（CVはスプシUTAGEから取得）
 */
import { config } from 'dotenv';
import * as path from 'path';
const envPath = path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env');
const r = config({ path: envPath });
console.log(`dotenv loaded ${Object.keys(r.parsed ?? {}).length} vars from ${envPath}`);

import { PrismaClient } from '@prisma/client';
import { GoogleSheetsService } from './src/google-sheets/google-sheets.service';
import * as fs from 'fs';

// 最小限のConfigService互換
class MiniConfigService {
  get<T = string>(key: string): T | undefined {
    return process.env[key] as any;
  }
}

const AI_ACCOUNTS: Record<string, string> = {
  AI_1: '7468288053866561553',
  AI_2: '7523128243466551303',
  AI_3: '7543540647266074641',
  AI_4: '7580666710525493255',
};
const PERIOD_START = new Date('2026-04-01T00:00:00+09:00');
const PERIOD_END = new Date('2026-04-15T00:00:00+09:00');

function parseAdName(adName: string): { cr: string; lpName: string } | null {
  const parts = adName.split('/');
  if (parts.length < 4) return null;
  const cr = parts.slice(2, parts.length - 1).join('/');
  const lpName = parts[parts.length - 1];
  return { cr, lpName };
}

async function main() {
  const prisma = new PrismaClient();
  const sheets = new GoogleSheetsService(new MiniConfigService() as any);

  // 1) Appeal(AI) 取得
  const advertisers = await prisma.advertiser.findMany({
    where: { tiktokAdvertiserId: { in: Object.values(AI_ACCOUNTS) } },
    include: { appeal: true },
  });
  if (advertisers.length === 0) throw new Error('AI advertisers not found');

  // 全AI AdvertiserのAppealは同じ想定
  const appeal = advertisers[0].appeal;
  if (!appeal || !appeal.cvSpreadsheetUrl) throw new Error(`Appeal or cvSpreadsheetUrl missing for AI_1`);
  console.log(`Appeal: ${appeal.name}, CV URL: ${appeal.cvSpreadsheetUrl}`);

  const advNameByInternal = new Map<string, string>();
  for (const [name, ttId] of Object.entries(AI_ACCOUNTS)) {
    const adv = advertisers.find((a) => a.tiktokAdvertiserId === ttId);
    if (adv) advNameByInternal.set(adv.id, name);
  }

  // 2) Ads + Metrics
  const ads = await prisma.ad.findMany({
    where: { adGroup: { campaign: { advertiserId: { in: advertisers.map((a) => a.id) } } } },
    include: { adGroup: { include: { campaign: true } } },
  });
  const metrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      adId: { in: ads.map((a) => a.id) },
      statDate: { gte: PERIOD_START, lt: PERIOD_END },
    },
  });
  const spendByAd = new Map<string, number>();
  const impByAd = new Map<string, number>();
  const apiCvByAd = new Map<string, number>();
  for (const m of metrics) {
    if (!m.adId) continue;
    spendByAd.set(m.adId, (spendByAd.get(m.adId) ?? 0) + m.spend);
    impByAd.set(m.adId, (impByAd.get(m.adId) ?? 0) + m.impressions);
    apiCvByAd.set(m.adId, (apiCvByAd.get(m.adId) ?? 0) + m.conversions);
  }

  // 3) 稼働Ad（spend>=100）について、lpName別に集計してスプシ参照（重複呼び出し削減）
  type AdRow = {
    adId: string;
    account: string;
    cr: string;
    lpName: string;
    spend: number;
    imp: number;
    apiCv: number;
    sheetCv: number;
  };
  const rowsRaw: AdRow[] = [];
  for (const ad of ads) {
    const spend = spendByAd.get(ad.id) ?? 0;
    if (spend < 100) continue;
    const parsed = parseAdName(ad.name);
    if (!parsed) continue;
    rowsRaw.push({
      adId: ad.id,
      account: advNameByInternal.get(ad.adGroup.campaign.advertiserId) ?? '?',
      cr: parsed.cr,
      lpName: parsed.lpName,
      spend,
      imp: impByAd.get(ad.id) ?? 0,
      apiCv: apiCvByAd.get(ad.id) ?? 0,
      sheetCv: 0,
    });
  }

  // スプシCV取得（lpName単位でユニーク）
  const uniqueLps = [...new Set(rowsRaw.map((r) => r.lpName))];
  console.log(`\n対象広告: ${rowsRaw.length}件、ユニークLP: ${uniqueLps.length}`);
  console.log(`スプシからCV取得開始...`);

  // periodEnd は排他なので、countRegistrationPathのrowDate<=endに合わせて1秒引く
  const sheetEnd = new Date(PERIOD_END.getTime() - 1000);
  const cvByLp = new Map<string, number>();
  let idx = 0;
  for (const lp of uniqueLps) {
    idx++;
    const registrationPath = `TikTok広告-${appeal.name}-${lp}`;
    try {
      const cv = await sheets.getCVCount(
        appeal.name,
        appeal.cvSpreadsheetUrl,
        registrationPath,
        PERIOD_START,
        sheetEnd,
      );
      cvByLp.set(lp, cv);
      if (idx % 20 === 0) console.log(`  ${idx}/${uniqueLps.length} 処理済 (最新:${lp} CV=${cv})`);
    } catch (e: any) {
      console.error(`  ERR ${lp}: ${e.message}`);
      cvByLp.set(lp, 0);
    }
  }
  console.log(`取得完了: ${cvByLp.size}LP`);

  for (const r of rowsRaw) r.sheetCv = cvByLp.get(r.lpName) ?? 0;

  // 4b) 予算調整V2のSnapshotから各adごとの累計CV（todayCVCountの日毎max合計）を取得
  const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      advertiserId: { in: Object.values(AI_ACCOUNTS) },
      executionTime: { gte: PERIOD_START, lt: PERIOD_END },
    },
    orderBy: { executionTime: 'asc' },
  });
  // (adTiktokId, day) -> max todayCVCount
  const dailyMax = new Map<string, number>();
  for (const s of snaps) {
    const day = s.executionTime.toISOString().slice(0, 10);
    const key = `${s.adId}|${day}`;
    dailyMax.set(key, Math.max(dailyMax.get(key) ?? 0, s.todayCVCount ?? 0));
  }
  const v2CvByAdTiktok = new Map<string, number>();
  for (const [k, v] of dailyMax) {
    const [adTt] = k.split('|');
    v2CvByAdTiktok.set(adTt, (v2CvByAdTiktok.get(adTt) ?? 0) + v);
  }
  // internal ad.id -> tiktokId
  const tiktokByInternal = new Map<string, string>();
  for (const ad of ads) tiktokByInternal.set(ad.id, ad.tiktokId);
  const v2CvByInternal = new Map<string, number>();
  for (const [internal, tt] of tiktokByInternal) {
    v2CvByInternal.set(internal, v2CvByAdTiktok.get(tt) ?? 0);
  }

  // 4) CR合計（account別＆全体）
  // 注意: スプシCVは lpName単位で取得したので、同一lpName＋同一CR×同一accountでは
  // 複数Ad並走の場合、1広告につきLP単位CVを全部付けると重複カウントになる。
  // → lpName×account 単位で1回だけカウントするように集計
  type Key = string;
  const perLpAcct = new Map<Key, { lpName: string; account: string; cr: string; spend: number; imp: number; apiCv: number; sheetCv: number; v2Cv: number; ads: number }>();
  for (const r of rowsRaw) {
    const key = `${r.lpName}|||${r.account}`;
    const cur = perLpAcct.get(key) ?? { lpName: r.lpName, account: r.account, cr: r.cr, spend: 0, imp: 0, apiCv: 0, sheetCv: r.sheetCv, v2Cv: 0, ads: 0 };
    cur.spend += r.spend;
    cur.imp += r.imp;
    cur.apiCv += r.apiCv;
    cur.v2Cv += v2CvByInternal.get(r.adId) ?? 0;
    cur.ads += 1;
    perLpAcct.set(key, cur);
  }
  // sheetCvは account 単位では按分できない。登録経路がlpNameまでなので、
  // 同一lpNameが複数accountで並走している場合、スプシ側はaccountで分けられない。
  // → sheetCvをlpName全体のものとして、account別は「参考値」扱い（全accountで重複表示）
  // ここでは account別にはそのままLP全CVを入れ、注記する

  // CR合計（全account統合）: LP単位のCVを一度だけカウント
  const crAgg = new Map<string, { cr: string; accounts: Set<string>; lps: Set<string>; spend: number; imp: number; apiCv: number; sheetCv: number; ads: number }>();
  for (const [, v] of perLpAcct) {
    const cur = crAgg.get(v.cr) ?? { cr: v.cr, accounts: new Set(), lps: new Set(), spend: 0, imp: 0, apiCv: 0, sheetCv: 0, ads: 0 };
    cur.accounts.add(v.account);
    cur.spend += v.spend;
    cur.imp += v.imp;
    cur.apiCv += v.apiCv;
    cur.ads += v.ads;
    cur.lps.add(v.lpName);
    crAgg.set(v.cr, cur);
  }
  // sheetCv は CR内のユニークLP分を1回ずつ
  for (const [, c] of crAgg) {
    for (const lp of c.lps) c.sheetCv += cvByLp.get(lp) ?? 0;
  }

  // === 出力 ===
  const crTotals = [...crAgg.values()].map((c) => ({
    cr: c.cr,
    accounts: c.accounts.size,
    accountList: [...c.accounts].sort().join(','),
    ads: c.ads,
    spend: Math.round(c.spend),
    imp: c.imp,
    apiCv: c.apiCv,
    sheetCv: c.sheetCv,
    apiCpa: c.apiCv > 0 ? Math.round(c.spend / c.apiCv) : null,
    sheetCpa: c.sheetCv > 0 ? Math.round(c.spend / c.sheetCv) : null,
  })).sort((a, b) => b.spend - a.spend);

  console.log('\n' + '='.repeat(120));
  console.log('【CR別サマリ（AI全体合計、消化降順、CVはスプシUTAGE）】');
  console.log('='.repeat(120));
  console.log('CR                                        | アカ数 | Ad数 | 消化        | スプシCV | スプシCPA | APIcv | APIcpa');
  console.log('-'.repeat(120));
  for (const r of crTotals) {
    const crLabel = r.cr.padEnd(40).substring(0, 40);
    const sheetCpaStr = r.sheetCpa !== null ? `¥${r.sheetCpa.toLocaleString()}` : '---';
    const apiCpaStr = r.apiCpa !== null ? `¥${r.apiCpa.toLocaleString()}` : '---';
    console.log(`${crLabel} | ${String(r.accounts).padStart(2)}(${r.accountList.padEnd(19).substring(0,19)}) | ${String(r.ads).padStart(3)} | ¥${r.spend.toLocaleString().padStart(10)} | ${String(r.sheetCv).padStart(7)} | ${sheetCpaStr.padStart(9)} | ${String(r.apiCv).padStart(5)} | ${apiCpaStr.padStart(8)}`);
  }

  // CR × account 詳細（※sheetCvはlpName単位なので、account別は重複注意）
  const perLpAcctArr = [...perLpAcct.values()].sort((a, b) => b.spend - a.spend);
  console.log('\n' + '='.repeat(120));
  console.log('【LP×アカウント 詳細（消化降順、スプシCVはLP単位）】');
  console.log('='.repeat(120));
  console.log('CR                              | LP                    | acct | Ad | 消化        | スプシCV(LP計) | APIcv | sheetCPA | APIcpa');
  console.log('-'.repeat(120));
  console.log('CR                              | LP                    | acct | Ad | 消化        | スプシCV | V2cv | APIcv | sheetCPA | v2CPA');
  console.log('-'.repeat(125));
  for (const r of perLpAcctArr) {
    const lpSheetCv = cvByLp.get(r.lpName) ?? 0;
    const sheetCpa = lpSheetCv > 0 ? Math.round(r.spend / lpSheetCv) : null;
    const v2Cpa = r.v2Cv > 0 ? Math.round(r.spend / r.v2Cv) : null;
    console.log(
      `${r.cr.padEnd(28).substring(0, 28)} | ${r.lpName.padEnd(20).substring(0, 20)} | ${r.account.padEnd(4)} | ${String(r.ads).padStart(2)} | ¥${r.spend.toLocaleString().padStart(10)} | ${String(lpSheetCv).padStart(7)} | ${String(r.v2Cv).padStart(4)} | ${String(r.apiCv).padStart(5)} | ${(sheetCpa !== null ? `¥${sheetCpa.toLocaleString()}` : '---').padStart(8)} | ${(v2Cpa !== null ? `¥${v2Cpa.toLocaleString()}` : '---').padStart(8)}`
    );
  }

  // CSV
  const csv = ['CR,accounts,accountList,ads,spend,sheetCV,sheetCPA,apiCV,apiCPA'];
  for (const r of crTotals) {
    csv.push(`"${r.cr}",${r.accounts},"${r.accountList}",${r.ads},${r.spend},${r.sheetCv},${r.sheetCpa ?? ''},${r.apiCv},${r.apiCpa ?? ''}`);
  }
  const outDir = process.cwd();
  fs.writeFileSync(path.join(outDir, 'ai-cpa-by-cr-sheets.csv'), csv.join('\n'), 'utf8');

  const csv2 = ['CR,LP,account,ads,spend,sheetCV_LP,v2CV,apiCV,sheetCPA,v2CPA,apiCPA'];
  for (const r of perLpAcctArr) {
    const lpCv = cvByLp.get(r.lpName) ?? 0;
    const sc = lpCv > 0 ? Math.round(r.spend / lpCv) : '';
    const vc = r.v2Cv > 0 ? Math.round(r.spend / r.v2Cv) : '';
    const ac = r.apiCv > 0 ? Math.round(r.spend / r.apiCv) : '';
    csv2.push(`"${r.cr}","${r.lpName}",${r.account},${r.ads},${r.spend},${lpCv},${r.v2Cv},${r.apiCv},${sc},${vc},${ac}`);
  }
  fs.writeFileSync(path.join(outDir, 'ai-cpa-by-lp-account-sheets.csv'), csv2.join('\n'), 'utf8');

  console.log('\nCSV出力:');
  console.log('  apps/backend/ai-cpa-by-cr-sheets.csv');
  console.log('  apps/backend/ai-cpa-by-lp-account-sheets.csv');

  console.log('\n※注意事項');
  console.log('- スプシCVはlpName単位で紐付け（登録経路=TikTok広告-AI-{lpName}）');
  console.log('- 同一LPが複数アカウントで並走している場合、LP単位のCVは合計として扱う');
  console.log('  → CR合計のスプシCPAは正しい。LP×アカウント別のスプシCVは参考値');
  console.log(`- 期間: ${PERIOD_START.toISOString()} 〜 ${PERIOD_END.toISOString()}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
