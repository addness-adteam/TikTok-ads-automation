/**
 * 4/4横展開15本をフロントCPO基準で再集計
 * AI フロント: APPEAL_AI_FRONT_SPREADSHEET_ID / シート TT【OTO】,TT【3day】
 * フロントCPO = 広告費 ÷ フロント購入数
 */
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';

async function main() {
  const prisma = new PrismaClient();
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS ?? '{}');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() as any });

  const frontSheetId = process.env.APPEAL_AI_FRONT_SPREADSHEET_ID!;
  const sheetNames = (process.env.APPEAL_AI_FRONT_SHEET_NAMES ?? 'TT【OTO】,TT【3day】').split(',').map(s => s.trim());
  console.log(`フロントスプシ: ${frontSheetId}\nシート: ${sheetNames.join(', ')}`);

  // 各シートから行読み取り → LP-CRマッチ数集計
  const targets = ['CR01146','CR01147','CR01148','CR01149','CR01150','CR01151','CR01152','CR01153','CR01154','CR01155','CR01156','CR01157','CR01158','CR01159','CR01160'];
  const frontCounts: Record<string, number> = {};
  const perSheet: Record<string, Record<string, number>> = {};
  for (const t of targets) frontCounts[t] = 0;

  for (const sheetName of sheetNames) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: frontSheetId,
        range: `${sheetName}!A:Z`,
      });
      const rows = res.data.values ?? [];
      console.log(`\n=== ${sheetName} 行数: ${rows.length} ===`);
      console.log(`ヘッダー:`, rows[0]?.slice(0, 10));

      // どの列にLP-CRがあるか
      const colMatches = new Map<number, number>();
      for (const row of rows.slice(1)) {
        for (let c = 0; c < row.length; c++) {
          if (typeof row[c] === 'string' && /LP\d+-?CR\d+/i.test(row[c])) {
            colMatches.set(c, (colMatches.get(c) ?? 0) + 1);
          }
        }
      }
      for (const [c, n] of [...colMatches.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  col ${c}: ${n}件 (header="${rows[0]?.[c]}")`);
      }
      const pathCol = [...colMatches.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (pathCol == null) { console.log('  LP-CR列なし、スキップ'); continue; }

      perSheet[sheetName] = {};
      for (const t of targets) perSheet[sheetName][t] = 0;
      for (const row of rows.slice(1)) {
        const pathStr = String(row[pathCol] ?? '');
        for (const t of targets) {
          if (new RegExp(t, 'i').test(pathStr)) {
            perSheet[sheetName][t] += 1;
            frontCounts[t] += 1;
          }
        }
      }
    } catch (e: any) {
      console.log(`  ERROR on ${sheetName}: ${e.message}`);
    }
  }

  console.log(`\n=== 4/4横展開15CR フロント購入（シート別） ===`);
  console.log('CR'.padEnd(9), ...sheetNames.map(s => s.padEnd(10)), '合計');
  for (const t of targets) {
    const parts = sheetNames.map(s => String(perSheet[s]?.[t] ?? 0).padEnd(10));
    console.log(t.padEnd(9), ...parts, frontCounts[t]);
  }

  // spend取得
  const ads = await prisma.ad.findMany({
    where: { OR: targets.map((t) => ({ name: { contains: t } })) },
    include: { adGroup: { include: { campaign: { include: { advertiser: true } } } } },
  });
  const metrics = await prisma.metric.findMany({
    where: { entityType: 'AD', adId: { in: ads.map((a) => a.id) } },
    select: { adId: true, spend: true },
  });
  const spendByAd = new Map<string, number>();
  for (const m of metrics) spendByAd.set(m.adId, (spendByAd.get(m.adId) ?? 0) + m.spend);

  const ACCOUNT_MAP: Record<string,string> = {
    '7468288053866561553':'AI_1','7523128243466551303':'AI_2','7543540647266074641':'AI_3','7580666710525493255':'AI_4',
  };

  console.log(`\n=== フロントCPO集計 ===`);
  console.log('CR        | acc  | spend      | CV(前) | フロント | フロントCPO  | CV→フロント転換率');

  // オプト件数も併記するため再取得
  const optRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.APPEAL_AI_CV_SPREADSHEET_ID!,
    range: `${process.env.APPEAL_AI_CV_SHEET_NAME!}!A:Z`,
  });
  const optRows = optRes.data.values ?? [];
  const optCounts: Record<string, number> = {};
  for (const t of targets) optCounts[t] = 0;
  for (const row of optRows.slice(1)) {
    const pathStr = String(row[3] ?? '');
    for (const t of targets) {
      if (new RegExp(t, 'i').test(pathStr)) optCounts[t] += 1;
    }
  }

  let totalSpend = 0, totalFront = 0, totalCv = 0;
  for (const t of targets) {
    const crAds = ads.filter((a) => a.name.includes(t));
    for (const ad of crAds) {
      const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId;
      const acc = ACCOUNT_MAP[advId ?? ''] ?? advId?.slice(-4);
      const spend = spendByAd.get(ad.id) ?? 0;
      const fr = frontCounts[t];
      const cv = optCounts[t];
      const fCpo = fr > 0 ? Math.round(spend / fr) : null;
      const rate = cv > 0 ? ((fr / cv) * 100).toFixed(1) + '%' : '-';
      console.log(`${t.padEnd(9)} | ${(acc ?? '').padEnd(4)} | ¥${Math.round(spend).toLocaleString().padStart(9)} | ${String(cv).padStart(5)} | ${String(fr).padStart(7)} | ${fCpo != null ? '¥' + fCpo.toLocaleString().padStart(8) : '    -    '} | ${rate}`);
      totalSpend += spend;
    }
    totalFront += frontCounts[t];
    totalCv += optCounts[t];
  }
  console.log(`\n合計: spend=¥${Math.round(totalSpend).toLocaleString()} / CV=${totalCv} / フロント=${totalFront}`);
  console.log(`平均CPA=¥${totalCv>0 ? Math.round(totalSpend/totalCv).toLocaleString() : '-'} / 平均フロントCPO=¥${totalFront>0 ? Math.round(totalSpend/totalFront).toLocaleString() : '-'}`);
  console.log(`CV→フロント転換率: ${totalCv>0 ? ((totalFront/totalCv)*100).toFixed(1)+'%' : '-'}`);

  // アカウント別集計
  console.log(`\n=== アカウント別フロントCPO ===`);
  const byAcc = new Map<string, { spend: number; front: number; cv: number }>();
  for (const t of targets) {
    const crAds = ads.filter((a) => a.name.includes(t));
    for (const ad of crAds) {
      const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId;
      const acc = ACCOUNT_MAP[advId ?? ''] ?? 'other';
      const spend = spendByAd.get(ad.id) ?? 0;
      const cur = byAcc.get(acc) ?? { spend: 0, front: 0, cv: 0 };
      cur.spend += spend;
      cur.front += frontCounts[t];
      cur.cv += optCounts[t];
      byAcc.set(acc, cur);
    }
  }
  // ↑ ちゃんとCR単位で足さないとCR越しで二重計上になるので再計算
  byAcc.clear();
  for (const t of targets) {
    const crAds = ads.filter((a) => a.name.includes(t));
    if (crAds.length === 0) continue;
    const firstAd = crAds[0];
    const advId = firstAd.adGroup?.campaign?.advertiser?.tiktokAdvertiserId;
    const acc = ACCOUNT_MAP[advId ?? ''] ?? 'other';
    const spend = crAds.reduce((s, a) => s + (spendByAd.get(a.id) ?? 0), 0);
    const cur = byAcc.get(acc) ?? { spend: 0, front: 0, cv: 0 };
    cur.spend += spend;
    cur.front += frontCounts[t];
    cur.cv += optCounts[t];
    byAcc.set(acc, cur);
  }
  console.log('acc   | spend      | CV   | フロント | 平均CPA    | フロントCPO  | CV→フロント');
  for (const [acc, v] of [...byAcc.entries()].sort()) {
    const cpa = v.cv>0 ? Math.round(v.spend/v.cv) : null;
    const fcpo = v.front>0 ? Math.round(v.spend/v.front) : null;
    const rate = v.cv>0 ? ((v.front/v.cv)*100).toFixed(1)+'%' : '-';
    console.log(`${acc.padEnd(5)} | ¥${Math.round(v.spend).toLocaleString().padStart(9)} | ${String(v.cv).padStart(4)} | ${String(v.front).padStart(7)} | ${cpa!=null?'¥'+cpa.toLocaleString().padStart(8):'    -   '} | ${fcpo!=null?'¥'+fcpo.toLocaleString().padStart(8):'    -   '} | ${rate}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
