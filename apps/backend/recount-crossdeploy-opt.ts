/**
 * 4/4横展開15本をオプト基準で再集計
 * AI オプトスプシ: APPEAL_AI_CV_SPREADSHEET_ID / シート TT_オプト
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

  // AIオプトスプシ全行
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.APPEAL_AI_CV_SPREADSHEET_ID!,
    range: `${process.env.APPEAL_AI_CV_SHEET_NAME!}!A:Z`,
  });
  const rows = res.data.values ?? [];
  console.log(`AIオプトシート 行数: ${rows.length}`);
  console.log(`ヘッダー:`, rows[0]);
  console.log(`サンプル行:`, rows[1]);
  console.log(`サンプル行(末):`, rows[rows.length - 1]);

  // どの列にLP-CR情報があるか検索
  const colMatches = new Map<number, number>();
  for (const row of rows.slice(1)) {
    for (let c = 0; c < row.length; c++) {
      if (typeof row[c] === 'string' && /LP\d+-?CR\d+/i.test(row[c])) {
        colMatches.set(c, (colMatches.get(c) ?? 0) + 1);
      }
    }
  }
  console.log(`\nLP-CR が出現する列:`);
  for (const [c, n] of [...colMatches.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  col ${c}: ${n}件 (header="${rows[0]?.[c]}")`);
  }

  // 日付列候補
  console.log(`\n日付列候補:`);
  for (let c = 0; c < (rows[0]?.length ?? 0); c++) {
    const sample = rows[1]?.[c];
    if (sample && /\d{4}[\/-]\d{1,2}[\/-]\d{1,2}/.test(String(sample))) {
      console.log(`  col ${c}: "${rows[0]?.[c]}" sample="${sample}"`);
    }
  }

  // 4/4横展開15CRを再集計
  const targets = ['CR01146','CR01147','CR01148','CR01149','CR01150','CR01151','CR01152','CR01153','CR01154','CR01155','CR01156','CR01157','CR01158','CR01159','CR01160'];
  console.log(`\n=== 4/4横展開15CR オプト件数（全期間） ===`);
  // パス列（最も多く出現する列）を自動選定
  const pathCol = [...colMatches.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  console.log(`使用するパス列: col ${pathCol}`);

  const counts: Record<string, number> = {};
  for (const t of targets) counts[t] = 0;
  for (const row of rows.slice(1)) {
    const pathStr = String(row[pathCol] ?? '');
    for (const t of targets) {
      if (new RegExp(t, 'i').test(pathStr)) counts[t] += 1;
    }
  }
  for (const [cr, n] of Object.entries(counts)) console.log(`  ${cr}: ${n}件`);

  // spendを取得してCPO比較
  console.log(`\n=== CPO再集計（DB Metric × オプト） ===`);
  const ads = await prisma.ad.findMany({
    where: { OR: targets.map((t) => ({ name: { contains: t } })) },
    include: { adGroup: { include: { campaign: { include: { advertiser: true } } } } },
  });
  const metrics = await prisma.metric.findMany({
    where: { entityType: 'AD', adId: { in: ads.map((a) => a.id) } },
    select: { adId: true, spend: true, impressions: true },
  });
  const spendByAd = new Map<string, { spend: number; imp: number }>();
  for (const m of metrics) {
    const cur = spendByAd.get(m.adId) ?? { spend: 0, imp: 0 };
    cur.spend += m.spend; cur.imp += m.impressions;
    spendByAd.set(m.adId, cur);
  }

  console.log('CR        | acc  | spend      | imp      | optCV | CPO      | CPM    | lpcr');
  let totalSpend = 0, totalCV = 0;
  const ACCOUNT_MAP: Record<string,string> = {
    '7468288053866561553':'AI_1','7523128243466551303':'AI_2','7543540647266074641':'AI_3','7580666710525493255':'AI_4',
  };
  for (const t of targets) {
    const crAds = ads.filter((a) => a.name.includes(t));
    for (const ad of crAds) {
      const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId;
      const acc = ACCOUNT_MAP[advId ?? ''] ?? advId?.slice(-4);
      const s = spendByAd.get(ad.id) ?? { spend: 0, imp: 0 };
      const cv = counts[t];
      const cpo = cv > 0 ? Math.round(s.spend / cv) : null;
      const cpm = s.imp > 0 ? Math.round((s.spend / s.imp) * 1000) : 0;
      const lpcrM = ad.name.match(/LP\d+-CR\d+/);
      console.log(`${t.padEnd(9)} | ${(acc ?? '').padEnd(4)} | ¥${Math.round(s.spend).toLocaleString().padStart(9)} | ${String(s.imp).padStart(8)} | ${String(cv).padStart(4)} | ${cpo != null ? '¥' + cpo.toLocaleString().padStart(7) : '   -   '} | ¥${String(cpm).padStart(4)} | ${lpcrM?.[0]}`);
      totalSpend += s.spend;
    }
    totalCV += counts[t];
  }
  console.log(`\n合計: spend=¥${Math.round(totalSpend).toLocaleString()} / optCV=${totalCV} / 平均CPO=¥${totalCV>0 ? Math.round(totalSpend/totalCV).toLocaleString() : '-'}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
