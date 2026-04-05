/**
 * AI導線 アカウント別 平均CPA・平均フロントCPO算出スクリプト
 *
 * 対象: AI_1, AI_2, AI_3, AI_4
 * 期間: 2025年9月〜2026年3月
 * データソース:
 *   - 消化額: DBのMetricテーブル
 *   - CV数: Google Sheets (TT_オプト)
 *   - フロント販売数: Google Sheets (TT【OTO】+ TT【3day】)
 *
 * 出力: CSVファイル（アカウント別 + 月別内訳）
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Google Sheets認証
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

// AI導線アカウント
const AI_ADVERTISERS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
  { id: '7580666710525493255', name: 'AI_4' },
];

// 対象期間
const START_DATE = new Date('2025-09-01T00:00:00+09:00');
const END_DATE = new Date('2026-03-31T23:59:59.999+09:00');

// 月別リスト
const MONTHS = [
  { label: '2025年9月', start: new Date('2025-09-01T00:00:00+09:00'), end: new Date('2025-09-30T23:59:59.999+09:00') },
  { label: '2025年10月', start: new Date('2025-10-01T00:00:00+09:00'), end: new Date('2025-10-31T23:59:59.999+09:00') },
  { label: '2025年11月', start: new Date('2025-11-01T00:00:00+09:00'), end: new Date('2025-11-30T23:59:59.999+09:00') },
  { label: '2025年12月', start: new Date('2025-12-01T00:00:00+09:00'), end: new Date('2025-12-31T23:59:59.999+09:00') },
  { label: '2026年1月', start: new Date('2026-01-01T00:00:00+09:00'), end: new Date('2026-01-31T23:59:59.999+09:00') },
  { label: '2026年2月', start: new Date('2026-02-01T00:00:00+09:00'), end: new Date('2026-02-28T23:59:59.999+09:00') },
  { label: '2026年3月', start: new Date('2026-03-01T00:00:00+09:00'), end: new Date('2026-03-31T23:59:59.999+09:00') },
];

interface SheetData {
  rows: any[][];
  pathColIndex: number;
  dateColIndex: number;
}

/**
 * 広告名からLP名（最後のパート）を抽出
 * 例: "260204/田中/新春CR/LP1-CR00797" → "LP1-CR00797"
 */
function extractLPName(adName: string): string | null {
  if (!adName) return null;
  const parts = adName.split('/');
  if (parts.length < 4) return null;
  return parts[parts.length - 1];
}

/**
 * 登録経路を生成
 * 例: LP1-CR00797, AI → "TikTok広告-AI-LP1-CR00797"
 */
function generateRegistrationPath(lpName: string, appealName: string): string {
  return `TikTok広告-${appealName}-${lpName}`;
}

/**
 * スプレッドシートURLからIDを抽出
 */
function extractSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

/**
 * シート全体を読み込み
 */
async function loadSheet(spreadsheetId: string, sheetName: string): Promise<SheetData | null> {
  try {
    console.log(`  シート読み込み中: ${sheetName}`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    const rows = response.data?.values || [];
    if (rows.length === 0) return null;

    const headerRow = rows[0];
    let pathColIndex = -1;
    let dateColIndex = -1;

    for (let i = 0; i < headerRow.length; i++) {
      const header = String(headerRow[i]).trim();
      if (['登録経路', '流入経路', 'ファネル登録経路'].includes(header)) {
        pathColIndex = i;
      }
      if (['登録日時', '登録日', 'アクション実行日時', '実行日時'].includes(header)) {
        dateColIndex = i;
      }
    }

    if (pathColIndex === -1 || dateColIndex === -1) {
      console.log(`    列が見つかりません: path=${pathColIndex}, date=${dateColIndex}`);
      return null;
    }

    console.log(`    ${rows.length - 1}行のデータを読み込み`);
    return { rows, pathColIndex, dateColIndex };
  } catch (error: any) {
    console.log(`    エラー: ${error.message}`);
    return null;
  }
}

/**
 * 登録経路ごとのカウントを事前計算（期間指定）
 */
function buildRegistrationPathCounts(
  sheetData: SheetData,
  startDate: Date,
  endDate: Date,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (let i = 1; i < sheetData.rows.length; i++) {
    const row = sheetData.rows[i];
    const pathValue = row[sheetData.pathColIndex];
    const dateValue = row[sheetData.dateColIndex];

    if (!pathValue || !dateValue) continue;

    const rowDate = new Date(dateValue);
    if (isNaN(rowDate.getTime())) continue;
    if (rowDate < startDate || rowDate > endDate) continue;

    const currentCount = counts.get(pathValue) || 0;
    counts.set(pathValue, currentCount + 1);
  }

  return counts;
}

/**
 * 月別でカウントを返す
 */
function buildMonthlyCountsForPath(
  sheetData: SheetData,
  registrationPath: string,
): Map<string, number> {
  const monthlyCounts = new Map<string, number>();

  for (const month of MONTHS) {
    monthlyCounts.set(month.label, 0);
  }

  for (let i = 1; i < sheetData.rows.length; i++) {
    const row = sheetData.rows[i];
    const pathValue = row[sheetData.pathColIndex];
    const dateValue = row[sheetData.dateColIndex];

    if (!pathValue || !dateValue) continue;
    if (pathValue !== registrationPath) continue;

    const rowDate = new Date(dateValue);
    if (isNaN(rowDate.getTime())) continue;

    for (const month of MONTHS) {
      if (rowDate >= month.start && rowDate <= month.end) {
        monthlyCounts.set(month.label, (monthlyCounts.get(month.label) || 0) + 1);
        break;
      }
    }
  }

  return monthlyCounts;
}

async function main() {
  console.log('=== AI導線 アカウント別 平均CPA・平均フロントCPO算出 ===\n');
  console.log(`対象期間: 2025年9月〜2026年3月`);
  console.log(`対象アカウント: ${AI_ADVERTISERS.map(a => a.name).join(', ')}\n`);

  const outputDir = path.join(__dirname, 'exports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // ========================================
  // Step 1: 訴求情報と紐づけを取得
  // ========================================
  const advertisers = await prisma.advertiser.findMany({
    where: {
      tiktokAdvertiserId: { in: AI_ADVERTISERS.map(a => a.id) },
    },
    include: { appeal: true },
  });

  console.log(`DB内のAI Advertiser数: ${advertisers.length}`);

  // AI導線の訴求を特定
  const aiAppeal = advertisers.find(a => a.appeal)?.appeal;
  if (!aiAppeal) {
    console.error('AI導線の訴求が見つかりません');
    await prisma.$disconnect();
    return;
  }
  console.log(`訴求: ${aiAppeal.name}`);
  console.log(`CVスプレッドシート: ${aiAppeal.cvSpreadsheetUrl}`);
  console.log(`フロントスプレッドシート: ${aiAppeal.frontSpreadsheetUrl}`);

  // ========================================
  // Step 2: スプレッドシートを読み込み
  // ========================================
  console.log('\nスプレッドシートを読み込み中...');

  let cvSheetData: SheetData | null = null;
  let frontOTOSheetData: SheetData | null = null;
  let front3daySheetData: SheetData | null = null;

  if (aiAppeal.cvSpreadsheetUrl) {
    const spreadsheetId = extractSpreadsheetId(aiAppeal.cvSpreadsheetUrl);
    if (spreadsheetId) {
      cvSheetData = await loadSheet(spreadsheetId, 'TT_オプト');
    }
  }

  if (aiAppeal.frontSpreadsheetUrl) {
    const spreadsheetId = extractSpreadsheetId(aiAppeal.frontSpreadsheetUrl);
    if (spreadsheetId) {
      frontOTOSheetData = await loadSheet(spreadsheetId, 'TT【OTO】');
      front3daySheetData = await loadSheet(spreadsheetId, 'TT【3day】');
    }
  }

  // ========================================
  // Step 3: 全期間のCV・フロントカウントを事前計算
  // ========================================
  console.log('\nCV・フロント販売数を事前計算中...');

  // 全期間カウント
  const cvCountsTotal = cvSheetData
    ? buildRegistrationPathCounts(cvSheetData, START_DATE, END_DATE)
    : new Map<string, number>();

  const frontCountsTotal = new Map<string, number>();
  if (frontOTOSheetData) {
    const otoCounts = buildRegistrationPathCounts(frontOTOSheetData, START_DATE, END_DATE);
    for (const [p, c] of otoCounts) frontCountsTotal.set(p, (frontCountsTotal.get(p) || 0) + c);
  }
  if (front3daySheetData) {
    const tdayCounts = buildRegistrationPathCounts(front3daySheetData, START_DATE, END_DATE);
    for (const [p, c] of tdayCounts) frontCountsTotal.set(p, (frontCountsTotal.get(p) || 0) + c);
  }

  // 月別カウント
  const cvCountsByMonth = new Map<string, Map<string, number>>(); // month -> path -> count
  const frontCountsByMonth = new Map<string, Map<string, number>>();

  for (const month of MONTHS) {
    if (cvSheetData) {
      cvCountsByMonth.set(month.label, buildRegistrationPathCounts(cvSheetData, month.start, month.end));
    }

    const monthFrontCounts = new Map<string, number>();
    if (frontOTOSheetData) {
      const otoCounts = buildRegistrationPathCounts(frontOTOSheetData, month.start, month.end);
      for (const [p, c] of otoCounts) monthFrontCounts.set(p, (monthFrontCounts.get(p) || 0) + c);
    }
    if (front3daySheetData) {
      const tdayCounts = buildRegistrationPathCounts(front3daySheetData, month.start, month.end);
      for (const [p, c] of tdayCounts) monthFrontCounts.set(p, (monthFrontCounts.get(p) || 0) + c);
    }
    frontCountsByMonth.set(month.label, monthFrontCounts);
  }

  console.log(`  CV登録経路数（全期間）: ${cvCountsTotal.size}`);
  console.log(`  フロント登録経路数（全期間）: ${frontCountsTotal.size}`);

  // ========================================
  // Step 4: DB Metricからアカウント別消化額を取得
  // ========================================
  console.log('\nDB Metricからアカウント別消化額を取得中...');

  const adMetrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      statDate: {
        gte: START_DATE,
        lte: END_DATE,
      },
      ad: {
        adGroup: {
          campaign: {
            advertiser: {
              tiktokAdvertiserId: { in: AI_ADVERTISERS.map(a => a.id) },
            },
          },
        },
      },
    },
    include: {
      ad: {
        include: {
          adGroup: {
            include: {
              campaign: {
                include: {
                  advertiser: true,
                },
              },
            },
          },
        },
      },
    },
  });

  console.log(`  -> ${adMetrics.length}件の日別メトリクスを取得`);

  // ========================================
  // Step 5: アカウント別・月別に集計
  // ========================================
  interface AccountMonthData {
    spend: number;
    registrationPaths: Set<string>;
  }

  interface AccountData {
    name: string;
    totalSpend: number;
    totalCV: number;
    totalFrontSales: number;
    registrationPaths: Set<string>;
    monthly: Map<string, AccountMonthData>;
  }

  const accountDataMap = new Map<string, AccountData>();

  // 初期化
  for (const adv of AI_ADVERTISERS) {
    const monthly = new Map<string, AccountMonthData>();
    for (const month of MONTHS) {
      monthly.set(month.label, { spend: 0, registrationPaths: new Set() });
    }
    accountDataMap.set(adv.id, {
      name: adv.name,
      totalSpend: 0,
      totalCV: 0,
      totalFrontSales: 0,
      registrationPaths: new Set(),
      monthly,
    });
  }

  // メトリクスを集計
  for (const m of adMetrics) {
    const advertiserId = m.ad?.adGroup?.campaign?.advertiser?.tiktokAdvertiserId;
    if (!advertiserId) continue;

    const accountData = accountDataMap.get(advertiserId);
    if (!accountData) continue;

    const adName = m.ad?.name || '';
    const lpName = extractLPName(adName);
    const registrationPath = lpName
      ? generateRegistrationPath(lpName, aiAppeal.name)
      : '';

    // 消化額を加算
    accountData.totalSpend += m.spend;
    if (registrationPath) {
      accountData.registrationPaths.add(registrationPath);
    }

    // 月別集計
    const statDate = new Date(m.statDate);
    for (const month of MONTHS) {
      if (statDate >= month.start && statDate <= month.end) {
        const monthData = accountData.monthly.get(month.label)!;
        monthData.spend += m.spend;
        if (registrationPath) {
          monthData.registrationPaths.add(registrationPath);
        }
        break;
      }
    }
  }

  // CV・フロント販売数をアカウント別に集計（登録経路ベース）
  for (const [, accountData] of accountDataMap) {
    // 全期間のCV・フロント
    for (const regPath of accountData.registrationPaths) {
      accountData.totalCV += cvCountsTotal.get(regPath) || 0;
      accountData.totalFrontSales += frontCountsTotal.get(regPath) || 0;
    }
  }

  // ========================================
  // Step 6: CSV出力
  // ========================================

  // --- CSV 1: アカウント別サマリー ---
  const summaryRows: string[] = [];
  summaryRows.push('アカウント名,総消化額,総CV数,平均CPA,総フロント販売数,平均フロントCPO,広告登録経路数');

  for (const adv of AI_ADVERTISERS) {
    const data = accountDataMap.get(adv.id)!;
    const avgCPA = data.totalCV > 0 ? data.totalSpend / data.totalCV : 0;
    const avgFrontCPO = data.totalFrontSales > 0 ? data.totalSpend / data.totalFrontSales : 0;

    summaryRows.push([
      data.name,
      data.totalSpend.toFixed(0),
      data.totalCV,
      avgCPA > 0 ? avgCPA.toFixed(0) : 'N/A',
      data.totalFrontSales,
      avgFrontCPO > 0 ? avgFrontCPO.toFixed(0) : 'N/A',
      data.registrationPaths.size,
    ].join(','));

    console.log(`\n${data.name}:`);
    console.log(`  消化額: ¥${data.totalSpend.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`);
    console.log(`  CV数: ${data.totalCV}`);
    console.log(`  平均CPA: ${avgCPA > 0 ? `¥${avgCPA.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}` : 'N/A'}`);
    console.log(`  フロント販売数: ${data.totalFrontSales}`);
    console.log(`  平均フロントCPO: ${avgFrontCPO > 0 ? `¥${avgFrontCPO.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}` : 'N/A'}`);
    console.log(`  登録経路数: ${data.registrationPaths.size}`);
  }

  // 全アカウント合計
  const allSpend = AI_ADVERTISERS.reduce((s, a) => s + accountDataMap.get(a.id)!.totalSpend, 0);
  const allCV = AI_ADVERTISERS.reduce((s, a) => s + accountDataMap.get(a.id)!.totalCV, 0);
  const allFront = AI_ADVERTISERS.reduce((s, a) => s + accountDataMap.get(a.id)!.totalFrontSales, 0);
  const allCPA = allCV > 0 ? allSpend / allCV : 0;
  const allFrontCPO = allFront > 0 ? allSpend / allFront : 0;

  summaryRows.push([
    '合計',
    allSpend.toFixed(0),
    allCV,
    allCPA > 0 ? allCPA.toFixed(0) : 'N/A',
    allFront,
    allFrontCPO > 0 ? allFrontCPO.toFixed(0) : 'N/A',
    '',
  ].join(','));

  console.log(`\n=== 全アカウント合計 ===`);
  console.log(`  消化額: ¥${allSpend.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`);
  console.log(`  CV数: ${allCV} / 平均CPA: ${allCPA > 0 ? `¥${allCPA.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}` : 'N/A'}`);
  console.log(`  フロント販売数: ${allFront} / 平均フロントCPO: ${allFrontCPO > 0 ? `¥${allFrontCPO.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}` : 'N/A'}`);

  // --- CSV 2: アカウント別月別内訳 ---
  const monthlyRows: string[] = [];
  monthlyRows.push('アカウント名,月,消化額,CV数,CPA,フロント販売数,フロントCPO');

  for (const adv of AI_ADVERTISERS) {
    const data = accountDataMap.get(adv.id)!;

    for (const month of MONTHS) {
      const monthData = data.monthly.get(month.label)!;

      // 月別のCV・フロント販売数
      let monthCV = 0;
      let monthFront = 0;
      for (const regPath of monthData.registrationPaths) {
        monthCV += cvCountsByMonth.get(month.label)?.get(regPath) || 0;
        monthFront += frontCountsByMonth.get(month.label)?.get(regPath) || 0;
      }

      const monthCPA = monthCV > 0 ? monthData.spend / monthCV : 0;
      const monthFrontCPO = monthFront > 0 ? monthData.spend / monthFront : 0;

      monthlyRows.push([
        data.name,
        month.label,
        monthData.spend.toFixed(0),
        monthCV,
        monthCPA > 0 ? monthCPA.toFixed(0) : 'N/A',
        monthFront,
        monthFrontCPO > 0 ? monthFrontCPO.toFixed(0) : 'N/A',
      ].join(','));
    }
  }

  // ファイル出力
  const summaryPath = path.join(outputDir, 'AI導線_アカウント別_平均CPA_フロントCPO_2025年9月-2026年3月.csv');
  fs.writeFileSync(summaryPath, '\uFEFF' + summaryRows.join('\n'), 'utf8');
  console.log(`\nサマリーCSV: ${summaryPath}`);

  const monthlyPath = path.join(outputDir, 'AI導線_アカウント別月別_CPA_フロントCPO_2025年9月-2026年3月.csv');
  fs.writeFileSync(monthlyPath, '\uFEFF' + monthlyRows.join('\n'), 'utf8');
  console.log(`月別CSV: ${monthlyPath}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  prisma.$disconnect();
  process.exit(1);
});
