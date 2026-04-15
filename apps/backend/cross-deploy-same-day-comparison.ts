/**
 * 同日横展開の効果比較
 * 広告名から (出稿日, 元CR) を抽出し、同グループ内でアカウント別CPO比較
 * - spend: DB Metric (parseStatDate修正後)
 * - CV: スプシ(UTAGE個別予約)基準で集計（LP-CRコード突合・広告費按分）
 */
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import * as fs from 'fs';

const ACCOUNTS: Record<string, string> = {
  AI_1: '7468288053866561553',
  AI_2: '7523128243466551303',
  AI_3: '7543540647266074641',
  AI_4: '7580666710525493255',
  SP1: '7474920444831875080',
  SP2: '7592868952431362066',
  SP3: '7616545514662051858',
  SNS1: '7247073333517238273',
  SNS2: '7543540100849156112',
  SNS3: '7543540381615800337',
};

// 導線 → スプシ情報
const SHEETS_CONFIG: { channel: string; accounts: string[]; sheetName: string }[] = [
  { channel: 'AI', accounts: ['AI_1', 'AI_2', 'AI_3', 'AI_4'], sheetName: 'AI' },
  { channel: 'SEMINAR', accounts: ['SP1', 'SP2', 'SP3'], sheetName: 'スキルプラス（オートウェビナー用）' },
  { channel: 'SNS', accounts: ['SNS1', 'SNS2', 'SNS3'], sheetName: 'SNS' },
];
const UTAGE_SPREADSHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function getSheetCv(sheetName: string): Promise<Map<string, Map<string, number>>> {
  // 返却: Map<LP-CR, Map<YYYY-MM-DD, count>>
  const result = new Map<string, Map<string, number>>();
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS ?? process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? '{}'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() as any });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: UTAGE_SPREADSHEET_ID,
    range: `${sheetName}!A:BZ`,
  });
  const rows = res.data.values ?? [];
  if (rows.length < 2) return result;
  // 列構造推定: col 0 = 日付, col 46 = 登録経路(LP-CR含む) という既存調査結果に従う
  for (const row of rows.slice(1)) {
    const dateRaw = row[0];
    const path = row[46];
    if (!dateRaw || !path) continue;
    // 日付正規化
    let day = '';
    const m = String(dateRaw).match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (m) day = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (!day) continue;
    // LP-CRコード抽出 (e.g., LP1-CR01159)
    const crMatches = String(path).match(/LP\d+-CR\d+/gi) ?? [];
    for (const cr of crMatches) {
      const k = cr.toUpperCase();
      if (!result.has(k)) result.set(k, new Map());
      const inner = result.get(k)!;
      inner.set(day, (inner.get(day) ?? 0) + 1);
    }
  }
  return result;
}

function parseAdName(name: string): { deployDate?: string; sourceCR?: string; lpcr?: string } {
  // 例: 260404/横展開/CR178_横展開/LP1-CR01159
  const parts = name.split('/');
  const dateM = parts[0]?.match(/^(\d{6})$/);
  const deployDate = dateM ? `20${dateM[1].slice(0, 2)}-${dateM[1].slice(2, 4)}-${dateM[1].slice(4, 6)}` : undefined;
  // source CR from 3rd segment
  const srcM = parts[2]?.match(/CR\d+/i);
  const sourceCR = srcM ? srcM[0].toUpperCase() : undefined;
  const lpcrM = name.match(/LP\d+-CR\d+/i);
  const lpcr = lpcrM ? lpcrM[0].toUpperCase() : undefined;
  return { deployDate, sourceCR, lpcr };
}

function advIdToChannel(tiktokAdvId: string): { name: string; channel: string } | undefined {
  for (const [name, id] of Object.entries(ACCOUNTS)) {
    if (id === tiktokAdvId) {
      const cfg = SHEETS_CONFIG.find((c) => c.accounts.includes(name));
      return { name, channel: cfg?.channel ?? '?' };
    }
  }
  return undefined;
}

async function main() {
  const prisma = new PrismaClient();

  // 横展開広告を抽出
  const ads = await prisma.ad.findMany({
    where: { name: { contains: '横展開' } },
    include: { adGroup: { include: { campaign: { include: { advertiser: true } } } } },
  });
  console.log(`横展開広告: ${ads.length}件`);

  // (deployDate, sourceCR) でグルーピング
  type Group = {
    deployDate: string;
    sourceCR: string;
    ads: { adInternalId: string; adTiktokId: string; name: string; advTiktokId: string; channel: string; accountName: string; lpcr?: string }[];
  };
  const groups = new Map<string, Group>();
  for (const ad of ads) {
    const info = parseAdName(ad.name);
    if (!info.deployDate || !info.sourceCR) continue;
    const advTiktok = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId;
    if (!advTiktok) continue;
    const ch = advIdToChannel(advTiktok);
    if (!ch) continue;
    const key = `${info.deployDate}|${info.sourceCR}`;
    if (!groups.has(key)) groups.set(key, { deployDate: info.deployDate, sourceCR: info.sourceCR, ads: [] });
    groups.get(key)!.ads.push({
      adInternalId: ad.id, adTiktokId: ad.tiktokId, name: ad.name,
      advTiktokId: advTiktok, channel: ch.channel, accountName: ch.name, lpcr: info.lpcr,
    });
  }

  // 複数アカウントに展開されているグループだけ残す
  const multiAccountGroups = [...groups.values()].filter((g) => new Set(g.ads.map((a) => a.accountName)).size >= 2);
  console.log(`複数アカウント展開グループ: ${multiAccountGroups.length}件\n`);

  // 対象ad_idリスト
  const targetAdIds = multiAccountGroups.flatMap((g) => g.ads.map((a) => a.adInternalId));

  // spend / imp DB Metric 集計（出稿日〜出稿日+7日 or 現在まで）
  const metrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      adId: { in: targetAdIds },
    },
    select: { adId: true, statDate: true, spend: true, impressions: true },
  });
  const spendByAd = new Map<string, { spend: number; imp: number; dayCount: number; firstDay?: string; lastDay?: string }>();
  for (const m of metrics) {
    const day = m.statDate.toISOString().slice(0, 10);
    const cur = spendByAd.get(m.adId) ?? { spend: 0, imp: 0, dayCount: 0 };
    cur.spend += m.spend;
    cur.imp += m.impressions;
    cur.dayCount += 1;
    cur.firstDay = !cur.firstDay || day < cur.firstDay ? day : cur.firstDay;
    cur.lastDay = !cur.lastDay || day > cur.lastDay ? day : cur.lastDay;
    spendByAd.set(m.adId, cur);
  }

  // スプシCV取得（導線ごと）
  console.log('スプシCV取得中...');
  const sheetCvByChannel = new Map<string, Map<string, Map<string, number>>>();
  for (const cfg of SHEETS_CONFIG) {
    try {
      const m = await getSheetCv(cfg.sheetName);
      sheetCvByChannel.set(cfg.channel, m);
      console.log(`  ${cfg.channel}: ${m.size} LP-CR entries`);
    } catch (e: any) {
      console.log(`  ${cfg.channel}: FAILED ${e.message}`);
      sheetCvByChannel.set(cfg.channel, new Map());
    }
  }

  // グループ単位で並べて出力
  const sorted = multiAccountGroups.sort((a, b) => (a.deployDate === b.deployDate ? a.sourceCR.localeCompare(b.sourceCR) : a.deployDate.localeCompare(b.deployDate)));

  const csvLines: string[] = ['deployDate,sourceCR,account,channel,adName,tiktokAdId,spend,imp,sheetCV,CPO,CPM'];
  console.log(`\n=== 同日横展開グループ別比較 ===`);
  for (const g of sorted) {
    console.log('='.repeat(120));
    console.log(`📅 ${g.deployDate} | 元CR=${g.sourceCR} | ${g.ads.length}本 (accounts: ${[...new Set(g.ads.map((a) => a.accountName))].join(', ')})`);
    console.log('-'.repeat(120));
    console.log('account | ch  | spend    | imp     | sheetCV | CPO     | CPM   | lpcr         ');
    for (const a of g.ads) {
      const s = spendByAd.get(a.adInternalId);
      const spend = s?.spend ?? 0;
      const imp = s?.imp ?? 0;
      // スプシCV: 導線→LP-CR→日付集計、出稿日以降の全日累計
      let sheetCV = 0;
      if (a.lpcr) {
        const chMap = sheetCvByChannel.get(a.channel);
        const dayMap = chMap?.get(a.lpcr.toUpperCase());
        if (dayMap) {
          for (const [d, c] of dayMap) if (d >= g.deployDate) sheetCV += c;
        }
      }
      const cpo = sheetCV > 0 ? Math.round(spend / sheetCV) : null;
      const cpm = imp > 0 ? Math.round((spend / imp) * 1000) : 0;
      console.log(`${a.accountName.padEnd(7)} | ${a.channel.padEnd(3)} | ¥${String(Math.round(spend)).padStart(7)} | ${String(imp).padStart(7)} | ${String(sheetCV).padStart(6)} | ${cpo != null ? '¥' + cpo.toLocaleString().padStart(7) : '   -   '} | ¥${cpm.toString().padStart(4)} | ${a.lpcr}`);
      csvLines.push(`${g.deployDate},${g.sourceCR},${a.accountName},${a.channel},"${a.name}",${a.adTiktokId},${Math.round(spend)},${imp},${sheetCV},${cpo ?? ''},${cpm}`);
    }
  }

  const csvPath = path.join(process.cwd(), 'cross-deploy-same-day-comparison.csv');
  fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf8');
  console.log(`\nCSV: ${csvPath}`);

  // サマリー: 同グループ内のCPOばらつき
  console.log(`\n=== サマリー: 同グループ内CPOばらつき (CV>0の広告のみ) ===`);
  for (const g of sorted) {
    const rows = g.ads.map((a) => {
      const s = spendByAd.get(a.adInternalId);
      const spend = s?.spend ?? 0;
      let sheetCV = 0;
      if (a.lpcr) {
        const chMap = sheetCvByChannel.get(a.channel);
        const dayMap = chMap?.get(a.lpcr.toUpperCase());
        if (dayMap) for (const [d, c] of dayMap) if (d >= g.deployDate) sheetCV += c;
      }
      return { account: a.accountName, spend, cv: sheetCV, cpo: sheetCV > 0 ? spend / sheetCV : null };
    });
    const withCv = rows.filter((r) => r.cpo != null);
    if (withCv.length < 2) continue;
    const cpos = withCv.map((r) => r.cpo!);
    const min = Math.min(...cpos), max = Math.max(...cpos);
    console.log(`${g.deployDate} ${g.sourceCR}: 展開${g.ads.length}本 / CV>0=${withCv.length}本 / CPO min=¥${Math.round(min).toLocaleString()} max=¥${Math.round(max).toLocaleString()} (${withCv.map((r) => `${r.account}:¥${Math.round(r.cpo!).toLocaleString()}`).join(', ')})`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
