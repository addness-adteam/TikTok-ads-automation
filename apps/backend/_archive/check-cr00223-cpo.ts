import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');

const prisma = new PrismaClient();
const RESERVATION_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function main() {
  // 1. Get all individual reservations for LP2-CR00223 from the AI sheet
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: RESERVATION_SHEET_ID,
    range: 'AI!A:AZ'
  });
  const rows = res.data.values || [];

  let reservationCount = 0;
  const reservationDates: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateValue = row[0]; // Column A
    const pathValue = row[46]; // Column AU
    if (!pathValue) continue;

    const lines = String(pathValue).split('\n');
    for (const line of lines) {
      if (line.trim().includes('LP2-CR00223')) {
        reservationCount++;
        reservationDates.push(String(dateValue || '').slice(0, 10));
      }
    }
  }

  console.log(`\n=== CR00223 (ClaudeCode解説LP2) 累計個別予約CPO ===\n`);
  console.log(`個別予約数: ${reservationCount}件`);
  if (reservationDates.length > 0) {
    console.log(`予約日: ${reservationDates.join(', ')}`);
  }

  // 2. Get total spend for all LP2-CR00223 ads
  const ads = await prisma.ad.findMany({
    where: { name: { contains: 'CR00223' } },
    select: {
      id: true, tiktokId: true, name: true, status: true,
      adGroup: { select: { campaign: { select: { advertiser: { select: { tiktokAdvertiserId: true } } } } } }
    }
  });

  // Filter for LP2-CR00223 in AI accounts
  const aiAccounts = ['7468288053866561553', '7523128243466551303', '7543540647266074641', '7580666710525493255'];
  const lp2Ads = ads.filter(a => {
    const advId = a.adGroup?.campaign?.advertiser?.tiktokAdvertiserId || '';
    return a.name?.includes('LP2-CR00223') && aiAccounts.includes(advId);
  });

  console.log(`\n対象広告: ${lp2Ads.length}本`);

  // Get ALL metrics for these ads (cumulative)
  const adDbIds = lp2Ads.map(a => a.id);
  const metrics = await prisma.metric.findMany({
    where: { adId: { in: adDbIds }, entityType: 'AD' },
    select: { adId: true, spend: true, conversions: true, impressions: true, statDate: true }
  });

  // Aggregate per ad
  const NAMES: Record<string,string> = {'7468288053866561553':'AI_1','7523128243466551303':'AI_2','7543540647266074641':'AI_3','7580666710525493255':'AI_4'};

  let grandTotalSpend = 0;
  let grandTotalCV = 0;

  for (const ad of lp2Ads) {
    const adMetrics = metrics.filter(m => m.adId === ad.id);
    const totalSpend = adMetrics.reduce((s, m) => s + m.spend, 0);
    const totalCV = adMetrics.reduce((s, m) => s + m.conversions, 0);
    const totalImp = adMetrics.reduce((s, m) => s + m.impressions, 0);
    const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId || '';
    const acc = NAMES[advId] || advId;
    const days = adMetrics.length;

    const cpa = totalCV > 0 ? totalSpend / totalCV : 0;
    console.log(`  ${acc} | ${ad.status} | ${ad.name}`);
    console.log(`    累計: 消化=¥${totalSpend.toFixed(0)}, CV=${totalCV}, CPA=¥${cpa.toFixed(0)}, imp=${totalImp.toLocaleString()}, ${days}日分`);

    grandTotalSpend += totalSpend;
    grandTotalCV += totalCV;
  }

  console.log(`\n── 全体合計 ──`);
  console.log(`  累計消化: ¥${grandTotalSpend.toFixed(0)}`);
  console.log(`  累計CV: ${grandTotalCV}`);
  console.log(`  累計CPA: ¥${grandTotalCV > 0 ? (grandTotalSpend / grandTotalCV).toFixed(0) : '-'}`);
  console.log(`  個別予約: ${reservationCount}件`);

  if (reservationCount > 0) {
    const cpo = grandTotalSpend / reservationCount;
    console.log(`  個別予約CPO: ¥${cpo.toFixed(0)}`);
    console.log(`  KPI上限: ¥53,795`);
    console.log(`  判定: ${cpo <= 53795 ? 'KPI以内 → 継続推奨' : 'KPI超過 → 停止検討'}`);
  } else {
    console.log(`  個別予約CPO: 算出不可（予約0件）`);
    console.log(`  判定: 個別予約0件 → 停止検討`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
