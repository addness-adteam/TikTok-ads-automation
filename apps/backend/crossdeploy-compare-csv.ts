/**
 * 4/4横展開15本を「同一アカウント×同一動画」と「別アカウント×同一動画」に分けてCSV出力
 */
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import * as fs from 'fs';

const ACCOUNT_MAP: Record<string, string> = {
  '7468288053866561553': 'AI_1',
  '7523128243466551303': 'AI_2',
  '7543540647266074641': 'AI_3',
  '7580666710525493255': 'AI_4',
};

// 元アカウント（この動画がもともとどのアカウントで出稿されていたか）
const SOURCE_ACCOUNT: Record<string, string> = {
  CR178: 'AI_3',
  CR454: 'AI_2',
};

// 無限増額バグ被害広告
const BUG_AFFECTED = new Set(['CR01150', 'CR01159', 'CR01156', 'CR01147']);

const TARGETS = [
  // CR178 (元AI_3)
  { cr: 'CR01155', source: 'CR178' },
  { cr: 'CR01156', source: 'CR178' },
  { cr: 'CR01157', source: 'CR178' },
  { cr: 'CR01158', source: 'CR178' },
  { cr: 'CR01159', source: 'CR178' },
  { cr: 'CR01160', source: 'CR178' },
  // CR454 (元AI_2)
  { cr: 'CR01146', source: 'CR454' },
  { cr: 'CR01147', source: 'CR454' },
  { cr: 'CR01148', source: 'CR454' },
  { cr: 'CR01149', source: 'CR454' },
  { cr: 'CR01150', source: 'CR454' },
  { cr: 'CR01151', source: 'CR454' },
  { cr: 'CR01152', source: 'CR454' },
  { cr: 'CR01153', source: 'CR454' },
  { cr: 'CR01154', source: 'CR454' },
];

async function main() {
  const prisma = new PrismaClient();
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS ?? '{}');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() as any });

  // オプト
  const optRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.APPEAL_AI_CV_SPREADSHEET_ID!,
    range: `${process.env.APPEAL_AI_CV_SHEET_NAME!}!A:Z`,
  });
  const optRows = optRes.data.values ?? [];
  const optByCR: Record<string, number> = {};
  for (const row of optRows.slice(1)) {
    const pathStr = String(row[3] ?? '');
    const m = pathStr.match(/CR0?\d+/g);
    if (!m) continue;
    for (const code of m) optByCR[code.toUpperCase()] = (optByCR[code.toUpperCase()] ?? 0) + 1;
  }

  // フロント
  const frontSheets = (process.env.APPEAL_AI_FRONT_SHEET_NAMES ?? 'TT【OTO】,TT【3day】').split(',').map(s => s.trim());
  const frontByCR: Record<string, number> = {};
  for (const sn of frontSheets) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.APPEAL_AI_FRONT_SPREADSHEET_ID!,
      range: `${sn}!A:Z`,
    });
    const rows = res.data.values ?? [];
    for (const row of rows.slice(1)) {
      const pathStr = String(row[4] ?? '');
      const m = pathStr.match(/CR0?\d+/g);
      if (!m) continue;
      for (const code of m) frontByCR[code.toUpperCase()] = (frontByCR[code.toUpperCase()] ?? 0) + 1;
    }
  }

  // DBから広告とMetric
  const ads = await prisma.ad.findMany({
    where: { OR: TARGETS.map((t) => ({ name: { contains: t.cr } })) },
    include: { adGroup: { include: { campaign: { include: { advertiser: true } } } } },
  });
  const metrics = await prisma.metric.findMany({
    where: { entityType: 'AD', adId: { in: ads.map((a) => a.id) } },
    select: { adId: true, spend: true, impressions: true },
  });
  const byAd = new Map<string, { spend: number; imp: number }>();
  for (const m of metrics) {
    const cur = byAd.get(m.adId) ?? { spend: 0, imp: 0 };
    cur.spend += m.spend; cur.imp += m.impressions;
    byAd.set(m.adId, cur);
  }

  // CSV行作成
  type Row = {
    group_type: string;
    source_cr: string;
    source_account: string;
    deploy_account: string;
    lp_cr: string;
    bug_affected: string;
    spend: number;
    imp: number;
    cpm: number;
    cv: number;
    front: number;
    cpa: string;
    front_cpo: string;
    cv_to_front_rate: string;
  };
  const rows: Row[] = [];

  for (const t of TARGETS) {
    const crAds = ads.filter((a) => a.name.includes(t.cr));
    for (const ad of crAds) {
      const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId ?? '';
      const deployAcc = ACCOUNT_MAP[advId] ?? advId.slice(-4);
      const s = byAd.get(ad.id) ?? { spend: 0, imp: 0 };
      const cv = optByCR[t.cr] ?? 0;
      const fr = frontByCR[t.cr] ?? 0;
      const spend = Math.round(s.spend);
      const imp = s.imp;
      const cpm = imp > 0 ? Math.round((s.spend / imp) * 1000) : 0;
      const cpa = cv > 0 ? Math.round(s.spend / cv).toString() : '';
      const fcpo = fr > 0 ? Math.round(s.spend / fr).toString() : '';
      const rate = cv > 0 ? ((fr / cv) * 100).toFixed(1) + '%' : '';
      const sourceAcc = SOURCE_ACCOUNT[t.source];
      const groupType = deployAcc === sourceAcc ? '同アカ×同動画' : '別アカ×同動画';
      rows.push({
        group_type: groupType,
        source_cr: t.source,
        source_account: sourceAcc,
        deploy_account: deployAcc,
        lp_cr: t.cr,
        bug_affected: BUG_AFFECTED.has(t.cr) ? 'YES' : 'NO',
        spend, imp, cpm, cv, front: fr,
        cpa, front_cpo: fcpo, cv_to_front_rate: rate,
      });
    }
  }

  // group_type → source_cr → deploy_account → lp_cr でソート
  rows.sort((a, b) => {
    if (a.group_type !== b.group_type) return a.group_type.localeCompare(b.group_type);
    if (a.source_cr !== b.source_cr) return a.source_cr.localeCompare(b.source_cr);
    if (a.deploy_account !== b.deploy_account) return a.deploy_account.localeCompare(b.deploy_account);
    return a.lp_cr.localeCompare(b.lp_cr);
  });

  const header = 'group_type,source_cr,source_account,deploy_account,lp_cr,bug_affected,spend,impressions,cpm,cv,front,cpa,front_cpo,cv_to_front_rate';
  const csvLines = [header];
  for (const r of rows) {
    csvLines.push(`${r.group_type},${r.source_cr},${r.source_account},${r.deploy_account},${r.lp_cr},${r.bug_affected},${r.spend},${r.imp},${r.cpm},${r.cv},${r.front},${r.cpa},${r.front_cpo},${r.cv_to_front_rate}`);
  }

  // グループ別サマリー行も追加
  csvLines.push('');
  csvLines.push('=== サマリー（group_type × source_cr × deploy_account） ===');
  csvLines.push('group_type,source_cr,deploy_account,ad_count,total_spend,total_cv,total_front,avg_cpa,avg_front_cpo,cv_to_front_rate');
  const summary = new Map<string, { spend: number; cv: number; front: number; count: number }>();
  for (const r of rows) {
    const k = `${r.group_type}|${r.source_cr}|${r.deploy_account}`;
    const cur = summary.get(k) ?? { spend: 0, cv: 0, front: 0, count: 0 };
    cur.spend += r.spend;
    cur.cv = r.cv; // cvはcr単位で同じ値なので上書きOK（同一crのadに同じcv値が入っている）
    cur.front = r.front;
    cur.count += 1;
    summary.set(k, cur);
  }
  // 上記のcv/frontはcr単位の値だが、deploy_accountは1cr=1ad前提なのでそのままでOK
  // ただし同一accに複数crがある場合は集計し直しが必要なので、crごとに集約する別処理
  const summary2 = new Map<string, { spend: number; cv: number; front: number; count: number; crs: Set<string> }>();
  for (const r of rows) {
    const k = `${r.group_type}|${r.source_cr}|${r.deploy_account}`;
    const cur = summary2.get(k) ?? { spend: 0, cv: 0, front: 0, count: 0, crs: new Set<string>() };
    cur.spend += r.spend;
    cur.count += 1;
    if (!cur.crs.has(r.lp_cr)) {
      cur.cv += r.cv;
      cur.front += r.front;
      cur.crs.add(r.lp_cr);
    }
    summary2.set(k, cur);
  }
  for (const [k, v] of [...summary2.entries()].sort()) {
    const [gt, sc, acc] = k.split('|');
    const avgCpa = v.cv > 0 ? Math.round(v.spend / v.cv) : '';
    const avgFcpo = v.front > 0 ? Math.round(v.spend / v.front) : '';
    const rate = v.cv > 0 ? ((v.front / v.cv) * 100).toFixed(1) + '%' : '';
    csvLines.push(`${gt},${sc},${acc},${v.count},${v.spend},${v.cv},${v.front},${avgCpa},${avgFcpo},${rate}`);
  }

  const csvPath = path.resolve(process.cwd(), 'crossdeploy-compare.csv');
  fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf8');
  console.log(`CSV出力: ${csvPath}`);
  console.log(`行数: 明細${rows.length}行 + サマリー${summary2.size}行`);
  console.log(`\n=== 明細プレビュー ===`);
  console.log(header);
  for (const r of rows) {
    console.log(`${r.group_type},${r.source_cr},${r.source_account},${r.deploy_account},${r.lp_cr},${r.bug_affected},${r.spend},${r.imp},${r.cpm},${r.cv},${r.front},${r.cpa},${r.front_cpo},${r.cv_to_front_rate}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
