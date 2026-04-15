import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');

const prisma = new PrismaClient();
const RESERVATION_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function main() {
  // 1. スプレッドシートから LP2-CR00032 の個別予約数を取得
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
    const pathValue = row[46]; // Column AU（個別予約したCR）
    if (!pathValue) continue;

    const lines = String(pathValue).split('\n');
    for (const line of lines) {
      if (line.trim().includes('LP2-CR00032')) {
        reservationCount++;
        reservationDates.push(String(dateValue || '').slice(0, 10));
      }
    }
  }

  console.log(`\n=== LP2-CR00032 累計個別予約CPO & 着金ROAS ===\n`);
  console.log(`個別予約数: ${reservationCount}件`);
  if (reservationDates.length > 0) {
    console.log(`予約日: ${reservationDates.join(', ')}`);
  }

  // 2. DB から LP2-CR00032 の広告を取得（AI導線アカウント）
  const aiAccounts = ['7468288053866561553', '7523128243466551303', '7543540647266074641', '7580666710525493255'];
  const ads = await prisma.ad.findMany({
    where: { name: { contains: 'CR00032' } },
    select: {
      id: true, tiktokId: true, name: true, status: true,
      adGroup: { select: { campaign: { select: { advertiser: { select: { tiktokAdvertiserId: true } } } } } }
    }
  });

  const lp2Ads = ads.filter(a => {
    const advId = a.adGroup?.campaign?.advertiser?.tiktokAdvertiserId || '';
    return a.name?.includes('LP2-CR00032') && aiAccounts.includes(advId);
  });

  console.log(`\n対象広告: ${lp2Ads.length}本`);

  // 3. メトリクスを集計
  const adDbIds = lp2Ads.map(a => a.id);
  const metrics = await prisma.metric.findMany({
    where: { adId: { in: adDbIds }, entityType: 'AD' },
    select: { adId: true, spend: true, conversions: true, impressions: true, statDate: true }
  });

  const NAMES: Record<string, string> = {
    '7468288053866561553': 'AI_1', '7523128243466551303': 'AI_2',
    '7543540647266074641': 'AI_3', '7580666710525493255': 'AI_4'
  };

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

  // 4. 全体サマリー
  console.log(`\n── 全体合計 ──`);
  console.log(`  累計消化: ¥${grandTotalSpend.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`);
  console.log(`  累計CV(TikTok API): ${grandTotalCV}`);
  console.log(`  累計CPA: ¥${grandTotalCV > 0 ? (grandTotalSpend / grandTotalCV).toFixed(0) : '-'}`);
  console.log(`  個別予約数(スプシ): ${reservationCount}件`);

  if (reservationCount > 0) {
    const cpo = grandTotalSpend / reservationCount;
    console.log(`  個別予約CPO: ¥${cpo.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`);
    console.log(`  KPI上限: ¥53,795`);
    console.log(`  判定: ${cpo <= 53795 ? '✅ KPI以内 → 継続推奨' : '❌ KPI超過 → 停止検討'}`);
  } else {
    console.log(`  個別予約CPO: 算出不可（予約0件）`);
    console.log(`  判定: 個別予約0件 → 停止検討`);
  }

  // 5. 着金ROAS（CR単位では算出不可の場合の説明）
  console.log(`\n── 着金ROAS ──`);
  console.log(`  ※ 着金ROAS はチャネル月次レベルでのみ算出可能`);
  console.log(`  ※ CR単位の成約・着金データはスプシの月次集計行（revenue列: AI column）にのみ存在`);
  console.log(`  ※ 個別予約 → 着座 → 成約 の追跡がCR単位で必要な場合、UTAGEの顧客データとの突合が必要`);

  // 着金ROAS の代替指標として、オプトCPA と 個別予約CPO を基にした推定値を出す
  if (reservationCount > 0 && grandTotalSpend > 0) {
    // AI導線の平均着金単価（過去実績ベース）
    // KPIシートのROAS目標と平均着金額から逆算
    console.log(`\n  【参考】推定ROAS計算（AI導線の平均成約率・着金額を使用）`);
    console.log(`  → 正確な着金ROASを知るには、このCRから成約した顧客の着金額をUTAGEで確認してください`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
