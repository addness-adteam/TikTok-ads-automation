import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';

async function main() {
  const prisma = new PrismaClient();

  // CR01153を含む広告
  const ads = await prisma.ad.findMany({
    where: { name: { contains: 'LP1-CR01153' } },
    select: { id: true, tiktokId: true, name: true, adGroup: { select: { campaign: { select: { advertiser: { select: { tiktokAdvertiserId: true } } } } } } },
  });
  console.log(`CR01153広告: ${ads.length}件`);
  for (const a of ads) console.log(`  ${a.tiktokId} | ${a.adGroup?.campaign?.advertiser?.tiktokAdvertiserId} | ${a.name}`);

  // Metric日別
  const adIds = ads.map(a => a.id);
  const metrics = await prisma.metric.findMany({
    where: { entityType: 'AD', adId: { in: adIds } },
    orderBy: { statDate: 'asc' },
    select: { statDate: true, spend: true, impressions: true, conversions: true },
  });
  console.log(`\n=== Metric日別 (全期間) ===`);
  let totalSpend = 0;
  for (const m of metrics) {
    console.log(`${m.statDate.toISOString().slice(0,10)} | spend=¥${m.spend.toLocaleString()} | imp=${m.impressions} | tiktokConv=${m.conversions}`);
    totalSpend += m.spend;
  }
  console.log(`期間: ${metrics[0]?.statDate.toISOString().slice(0,10)} ～ ${metrics[metrics.length-1]?.statDate.toISOString().slice(0,10)}`);
  console.log(`合計spend: ¥${totalSpend.toLocaleString()}`);

  // スプシ raw data で LP1-CR01153 に該当する行を全部出す
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS ?? '{}');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() as any });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA',
    range: 'AI!A:BZ',
  });
  const rows = res.data.values ?? [];
  console.log(`\n=== スプシ(AI) 全行数: ${rows.length} ===`);
  console.log(`=== LP1-CR01153 マッチ行 ===`);
  let matches = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const joined = row.join(' | ');
    if (/LP1-?CR0?1153/i.test(joined)) {
      matches++;
      console.log(`[row ${i}] date=${row[0]} | path=${row[46]?.slice(0,120)}`);
    }
  }
  console.log(`計 ${matches} 件`);

  // col 46じゃなくて他の列かも。col別にマッチ検索
  console.log(`\n=== 参考: どの列に "CR01153" が出るか ===`);
  const colMatches = new Map<number, number>();
  for (const row of rows.slice(1)) {
    for (let c = 0; c < row.length; c++) {
      if (typeof row[c] === 'string' && /CR0?1153/i.test(row[c])) {
        colMatches.set(c, (colMatches.get(c) ?? 0) + 1);
      }
    }
  }
  for (const [c, n] of [...colMatches.entries()].sort((a,b) => b[1]-a[1])) {
    console.log(`  col ${c}: ${n}件 (header="${rows[0]?.[c]}")`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
