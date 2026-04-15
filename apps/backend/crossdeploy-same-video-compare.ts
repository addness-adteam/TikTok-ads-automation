/**
 * 同一元動画を使った横展開グループ内のアカウント別比較
 * CR178 (6本) と CR454 (9本) をそれぞれアカウント別に集計
 */
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';

const ACCOUNT_MAP: Record<string, string> = {
  '7468288053866561553': 'AI_1',
  '7523128243466551303': 'AI_2',
  '7543540647266074641': 'AI_3',
  '7580666710525493255': 'AI_4',
};

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

  // 広告取得
  const targets = ['CR01146','CR01147','CR01148','CR01149','CR01150','CR01151','CR01152','CR01153','CR01154','CR01155','CR01156','CR01157','CR01158','CR01159','CR01160'];
  const ads = await prisma.ad.findMany({
    where: { OR: targets.map((t) => ({ name: { contains: t } })) },
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

  // CR178グループ (CR01155-01160) / CR454グループ (CR01146-01154)
  const groups = [
    { source: 'CR178 (AI_3 → AI_1/AI_2/AI_3)', crs: ['CR01155','CR01156','CR01157','CR01158','CR01159','CR01160'] },
    { source: 'CR454 (AI_2 → AI_1/AI_2/AI_3)', crs: ['CR01146','CR01147','CR01148','CR01149','CR01150','CR01151','CR01152','CR01153','CR01154'] },
  ];

  for (const g of groups) {
    console.log('\n' + '='.repeat(130));
    console.log(`【${g.source}】同一動画での横展開比較`);
    console.log('='.repeat(130));
    console.log('CR        | acc  | spend      | imp      | CPM   | CV  | フロント | CPA       | フロントCPO  | CV→フロント');
    const byAccAgg = new Map<string, { spend: number; imp: number; cv: number; front: number; crs: string[] }>();
    for (const cr of g.crs) {
      const crAds = ads.filter((a) => a.name.includes(cr));
      for (const ad of crAds) {
        const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId ?? '';
        const acc = ACCOUNT_MAP[advId] ?? advId.slice(-4);
        const s = byAd.get(ad.id) ?? { spend: 0, imp: 0 };
        const cv = optByCR[cr] ?? 0;
        const fr = frontByCR[cr] ?? 0;
        const cpm = s.imp > 0 ? Math.round((s.spend / s.imp) * 1000) : 0;
        const cpa = cv > 0 ? Math.round(s.spend / cv) : null;
        const fcpo = fr > 0 ? Math.round(s.spend / fr) : null;
        const rate = cv > 0 ? ((fr / cv) * 100).toFixed(1) + '%' : '-';
        console.log(`${cr.padEnd(9)} | ${acc.padEnd(4)} | ¥${Math.round(s.spend).toLocaleString().padStart(9)} | ${String(s.imp).padStart(8)} | ¥${String(cpm).padStart(4)} | ${String(cv).padStart(3)} | ${String(fr).padStart(7)} | ${cpa!=null?'¥'+cpa.toLocaleString().padStart(7):'   -   '} | ${fcpo!=null?'¥'+fcpo.toLocaleString().padStart(8):'    -   '} | ${rate}`);
        const cur = byAccAgg.get(acc) ?? { spend: 0, imp: 0, cv: 0, front: 0, crs: [] };
        cur.spend += s.spend;
        cur.imp += s.imp;
        cur.cv += cv;
        cur.front += fr;
        cur.crs.push(cr);
        byAccAgg.set(acc, cur);
      }
    }
    // アカウント合計
    console.log('-'.repeat(130));
    console.log('【アカウント別合計】');
    console.log('acc   | CR数 | spend      | imp      | CPM   | CV  | フロント | CPA       | フロントCPO  | CV→フロント');
    for (const [acc, v] of [...byAccAgg.entries()].sort()) {
      const cpm = v.imp > 0 ? Math.round((v.spend / v.imp) * 1000) : 0;
      const cpa = v.cv > 0 ? Math.round(v.spend / v.cv) : null;
      const fcpo = v.front > 0 ? Math.round(v.spend / v.front) : null;
      const rate = v.cv > 0 ? ((v.front / v.cv) * 100).toFixed(1) + '%' : '-';
      console.log(`${acc.padEnd(5)} | ${String(v.crs.length).padStart(3)} | ¥${Math.round(v.spend).toLocaleString().padStart(9)} | ${String(v.imp).padStart(8)} | ¥${String(cpm).padStart(4)} | ${String(v.cv).padStart(3)} | ${String(v.front).padStart(7)} | ${cpa!=null?'¥'+cpa.toLocaleString().padStart(7):'   -   '} | ${fcpo!=null?'¥'+fcpo.toLocaleString().padStart(8):'    -   '} | ${rate}`);
    }
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
