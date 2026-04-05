/**
 * スキルプラス導線 CR別初動3日間CPA算出スクリプト
 *
 * 対象: セミナー導線アカウント（広告主ID: 7474920444831875080）
 *
 * 出力項目:
 * - CR名（広告名）
 * - 配信開始日
 * - 初動3日間の費用 (DB)
 * - 初動3日間のCV数 (スプレッドシート)
 * - 初動3日間のCPA (費用 / CV数)
 */

import { google } from 'googleapis';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// 環境変数読み込み
dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

// セミナー導線アカウント設定
const ADVERTISER_ID = '7474920444831875080';
const ADVERTISER_NAME = 'セミナー導線アカウント';
const CV_SPREADSHEET_ID = '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk';
const SHEET_NAME = 'TT_オプト';

// 初動期間の日数
const INITIAL_PERIOD_DAYS = 3;

const TIKTOK_API_BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';

// 期待される列名
const EXPECTED_COLUMNS = {
  registrationPath: ['登録経路', '流入経路', 'registration_path', 'path', 'ファネル登録経路'],
  date: ['登録日時', '登録日', 'date', 'created_at', 'timestamp', 'アクション実行日時', '実行日時'],
};

interface CRInitialCPA {
  adId: string;
  adName: string;
  crName: string;
  lpName: string;
  registrationPath: string;
  startDate: string;
  endDate: string;
  spend: number;
  cvCount: number;
  cpa: number;
}

/**
 * Google Sheets認証を取得
 */
function getGoogleSheetsAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

/**
 * スプレッドシートからデータを取得
 */
async function getSheetData(spreadsheetId: string, sheetName: string): Promise<any[][]> {
  const auth = getGoogleSheetsAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
  });

  return response.data.values || [];
}

/**
 * 列位置を検出
 */
function detectColumnPositions(headerRow: string[]): { registrationPath: number; date: number } {
  let registrationPathCol = -1;
  let dateCol = -1;

  for (let i = 0; i < headerRow.length; i++) {
    const header = headerRow[i]?.toString().trim();

    if (EXPECTED_COLUMNS.registrationPath.includes(header)) {
      registrationPathCol = i;
    }
    if (EXPECTED_COLUMNS.date.includes(header)) {
      dateCol = i;
    }
  }

  // デフォルト値
  if (registrationPathCol === -1) registrationPathCol = 4; // E列
  if (dateCol === -1) dateCol = 5; // F列

  return { registrationPath: registrationPathCol, date: dateCol };
}

/**
 * 日付をパース
 */
function parseDate(dateString: string): Date | null {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date;
  } catch {
    return null;
  }
}

/**
 * 日付を YYYY-MM-DD 形式に変換
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * 日付を加算
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// キャッシュ用のグローバル変数
let cachedSheetData: any[][] | null = null;
let cachedColumnPositions: { registrationPath: number; date: number } | null = null;

/**
 * スプレッドシートデータを取得（キャッシュ付き）
 */
async function loadSheetDataOnce(): Promise<{
  rows: any[][];
  columnPositions: { registrationPath: number; date: number };
}> {
  if (cachedSheetData && cachedColumnPositions) {
    return { rows: cachedSheetData, columnPositions: cachedColumnPositions };
  }

  console.log(`スプレッドシートデータを取得中: ${CV_SPREADSHEET_ID} / ${SHEET_NAME}`);
  const rows = await getSheetData(CV_SPREADSHEET_ID, SHEET_NAME);

  if (!rows || rows.length === 0) {
    throw new Error(`シートにデータがありません: ${SHEET_NAME}`);
  }

  const columnPositions = detectColumnPositions(rows[0]);
  console.log(`  列位置: registrationPath=${columnPositions.registrationPath}, date=${columnPositions.date}`);

  cachedSheetData = rows;
  cachedColumnPositions = columnPositions;

  return { rows, columnPositions };
}

/**
 * スプレッドシートから登録経路のCV数をカウント（期間指定）
 */
async function countCVFromSpreadsheet(
  registrationPath: string,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  try {
    const { rows, columnPositions } = await loadSheetDataOnce();

    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const pathValue = row[columnPositions.registrationPath];
      const dateValue = row[columnPositions.date];

      if (!pathValue || !dateValue) continue;

      // 登録経路が一致するかチェック
      if (pathValue !== registrationPath) continue;

      // 日付が範囲内かチェック
      const rowDate = parseDate(dateValue);
      if (!rowDate) continue;

      if (rowDate >= startDate && rowDate <= endDate) {
        count++;
      }
    }

    return count;
  } catch (error) {
    console.error(`CV数取得エラー (${registrationPath}):`, error);
    return 0;
  }
}

/**
 * アクセストークンを取得
 */
function getAccessToken(): string {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) {
    throw new Error('環境変数 TIKTOK_ACCESS_TOKEN が設定されていません');
  }
  return token;
}

/**
 * TikTok APIからSmart+広告一覧を取得
 */
async function getSmartPlusAds(accessToken: string): Promise<any[]> {
  const allAds: any[] = [];
  let page = 1;
  const pageSize = 100;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/ad/get/`, {
        headers: { 'Access-Token': accessToken },
        params: {
          advertiser_id: ADVERTISER_ID,
          page_size: pageSize,
          page: page,
        },
      });

      const list = response.data.data?.list || [];
      if (list.length > 0) {
        for (const ad of list) {
          allAds.push({
            ad_id: ad.smart_plus_ad_id,
            ad_name: ad.smart_plus_ad_name || ad.ad_name,
            ...ad,
          });
        }
        const totalNumber = response.data.data?.page_info?.total_number || 0;
        const totalPages = Math.ceil(totalNumber / pageSize);
        hasMore = page < totalPages;
        page++;
      } else {
        hasMore = false;
      }
    } catch (error: any) {
      console.error(`Smart+広告取得エラー:`, error.response?.data || error.message);
      hasMore = false;
    }
  }

  return allAds;
}

/**
 * DBから広告の日別メトリクスを取得して配信開始日と初動3日間のspendを計算
 *
 * 重要: DBのメトリクスは「過去7日間の累計」で保存されているため、
 * 初動3日間のspendを正しく取得するには、3日目のメトリクスを使用する
 */
async function getAdMetricsFromDB(tiktokAdId: string): Promise<{
  startDate: string;
  endDate: string;
  spend: number;
} | null> {
  // 広告IDでDBの広告を検索
  const ad = await prisma.ad.findFirst({
    where: { tiktokId: tiktokAdId },
    select: { id: true },
  });

  if (!ad) {
    return null;
  }

  // 最も古いメトリクス日付（配信開始日）を取得
  const firstMetric = await prisma.metric.findFirst({
    where: {
      adId: ad.id,
      entityType: 'AD',
      spend: { gt: 0 }, // spendがある日のみ
    },
    orderBy: { statDate: 'asc' },
    select: { statDate: true },
  });

  if (!firstMetric) {
    return null;
  }

  const startDate = new Date(firstMetric.statDate);
  const endDate = addDays(startDate, INITIAL_PERIOD_DAYS - 1);

  // DBのメトリクスは「過去7日間の累計」で保存されているため、
  // 初動3日目（endDate）のメトリクスを取得すれば、それが1日目〜3日目の合計値
  const thirdDayMetric = await prisma.metric.findFirst({
    where: {
      adId: ad.id,
      entityType: 'AD',
      statDate: endDate,
    },
    select: { spend: true },
  });

  // 3日目のメトリクスがない場合は、最新のメトリクスを使用（配信日数が3日未満の場合）
  if (!thirdDayMetric) {
    const latestMetric = await prisma.metric.findFirst({
      where: {
        adId: ad.id,
        entityType: 'AD',
        spend: { gt: 0 },
      },
      orderBy: { statDate: 'desc' },
      select: { spend: true, statDate: true },
    });

    if (!latestMetric) {
      return null;
    }

    return {
      startDate: formatDate(startDate),
      endDate: formatDate(latestMetric.statDate),
      spend: latestMetric.spend || 0,
    };
  }

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    spend: thirdDayMetric.spend || 0,
  };
}

/**
 * 広告名からCR名とLP名を抽出
 */
function parseCRInfo(adName: string): { crName: string; lpName: string } | null {
  // パターン1: LP名-CR名 の形式 (例: LP2-CR00004, LP1-CR00123)
  const lpCrMatch = adName.match(/(LP\d+)[-_](CR\d+)/i);
  if (lpCrMatch) {
    return { lpName: lpCrMatch[1].toUpperCase(), crName: lpCrMatch[2].toUpperCase() };
  }

  // パターン2: CR番号のみ (例: CR00004) - デフォルトでLP2
  const crOnlyMatch = adName.match(/CR(\d{5})/i);
  if (crOnlyMatch) {
    return { lpName: 'LP2', crName: `CR${crOnlyMatch[1]}` };
  }

  // パターン3: スラッシュ区切りの最後の部分をチェック
  const parts = adName.split('/');
  if (parts.length >= 1) {
    const lastPart = parts[parts.length - 1];
    const lpCrMatch2 = lastPart.match(/(LP\d+)[-_]?(CR\d+)/i);
    if (lpCrMatch2) {
      return { lpName: lpCrMatch2[1].toUpperCase(), crName: lpCrMatch2[2].toUpperCase() };
    }
    // 最後のパートにCRのみある場合
    const crMatch = lastPart.match(/CR(\d{5})/i);
    if (crMatch) {
      return { lpName: 'LP2', crName: `CR${crMatch[1]}` };
    }
  }

  return null;
}

/**
 * 登録経路を生成
 */
function generateRegistrationPath(lpName: string, crName: string): string {
  return `TikTok広告-スキルプラス-${lpName}-${crName}`;
}

/**
 * CSVファイルに出力
 */
function exportToCSV(data: CRInitialCPA[], outputPath: string): void {
  const headers = [
    '広告ID',
    '広告名',
    'CR名',
    'LP名',
    '登録経路',
    '配信開始日',
    '初動終了日',
    '初動3日間費用',
    '初動3日間CV数',
    '初動3日間CPA',
  ];

  const rows = data.map(d => [
    d.adId,
    `"${d.adName.replace(/"/g, '""')}"`,
    d.crName,
    d.lpName,
    `"${d.registrationPath.replace(/"/g, '""')}"`,
    d.startDate,
    d.endDate,
    d.spend.toFixed(2),
    d.cvCount,
    d.cpa > 0 ? d.cpa.toFixed(2) : 'N/A',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(',')),
  ].join('\n');

  // BOM付きUTF-8で保存
  const bom = '\uFEFF';
  fs.writeFileSync(outputPath, bom + csvContent, 'utf-8');

  console.log(`CSVファイルを出力しました: ${outputPath}`);
}

/**
 * メイン処理
 */
async function main() {
  try {
    console.log('=== スキルプラス導線 CR別初動3日間CPA算出 ===\n');
    console.log(`対象アカウント: ${ADVERTISER_NAME} (${ADVERTISER_ID})`);
    console.log(`CVスプレッドシートID: ${CV_SPREADSHEET_ID}`);
    console.log(`初動期間: ${INITIAL_PERIOD_DAYS}日間\n`);

    // アクセストークン取得
    const accessToken = getAccessToken();
    console.log('アクセストークン取得完了\n');

    // Smart+広告一覧取得
    console.log('Smart+広告をAPIから取得中...');
    const smartPlusAds = await getSmartPlusAds(accessToken);
    console.log(`Smart+広告数: ${smartPlusAds.length}\n`);

    if (smartPlusAds.length === 0) {
      console.log('Smart+広告が見つかりませんでした。');
      return;
    }

    const results: CRInitialCPA[] = [];

    // 各広告を処理
    console.log('各広告のメトリクスとCV数を取得中...\n');
    let processedCount = 0;
    let skippedNoCR = 0;
    let skippedNoMetrics = 0;

    for (const ad of smartPlusAds) {
      const adId = ad.ad_id || ad.smart_plus_ad_id;
      const adName = ad.ad_name || ad.smart_plus_ad_name || '';

      // CR情報を抽出
      const crInfo = parseCRInfo(adName);
      if (!crInfo) {
        skippedNoCR++;
        continue;
      }

      // DBからメトリクスを取得
      const metrics = await getAdMetricsFromDB(adId);
      if (!metrics) {
        skippedNoMetrics++;
        continue;
      }

      // 登録経路を生成
      const registrationPath = generateRegistrationPath(crInfo.lpName, crInfo.crName);

      // CV数をスプレッドシートから取得
      const cvStartDate = new Date(metrics.startDate);
      const cvEndDate = new Date(metrics.endDate);
      cvEndDate.setHours(23, 59, 59, 999);

      const cvCount = await countCVFromSpreadsheet(
        registrationPath,
        cvStartDate,
        cvEndDate,
      );

      // CPA計算
      const cpa = cvCount > 0 ? metrics.spend / cvCount : 0;

      results.push({
        adId,
        adName,
        crName: crInfo.crName,
        lpName: crInfo.lpName,
        registrationPath,
        startDate: metrics.startDate,
        endDate: metrics.endDate,
        spend: metrics.spend,
        cvCount,
        cpa,
      });

      processedCount++;
      console.log(`[OK] ${crInfo.crName} (${crInfo.lpName})`);
      console.log(`     配信開始: ${metrics.startDate} ~ ${metrics.endDate}`);
      console.log(`     費用=¥${metrics.spend.toFixed(0)}, CV=${cvCount}, CPA=${cpa > 0 ? `¥${cpa.toFixed(0)}` : 'N/A'}`);
    }

    console.log(`\n処理結果: 成功=${processedCount}, CR名抽出不可=${skippedNoCR}, メトリクスなし=${skippedNoMetrics}`);

    // CR名でソート
    results.sort((a, b) => a.crName.localeCompare(b.crName));

    // CSV出力
    const outputDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const outputPath = path.join(outputDir, `スキルプラス導線_CR別初動3日間CPA_${timestamp}.csv`);

    exportToCSV(results, outputPath);

    // サマリー出力
    console.log('\n=== サマリー ===');
    console.log(`総CR数: ${results.length}`);
    console.log(`総費用: ¥${results.reduce((sum, r) => sum + r.spend, 0).toLocaleString()}`);
    console.log(`総CV数: ${results.reduce((sum, r) => sum + r.cvCount, 0)}`);

    const totalSpend = results.reduce((sum, r) => sum + r.spend, 0);
    const totalCV = results.reduce((sum, r) => sum + r.cvCount, 0);

    if (totalCV > 0) {
      console.log(`全体平均CPA: ¥${(totalSpend / totalCV).toFixed(0)}`);
    }

    // CVが発生したCRの数
    const crsWithCV = results.filter(r => r.cvCount > 0);
    console.log(`CV発生CR数: ${crsWithCV.length} / ${results.length}`);

    if (crsWithCV.length > 0) {
      const avgCPA = crsWithCV.reduce((sum, r) => sum + r.cpa, 0) / crsWithCV.length;
      console.log(`CV発生CRの平均CPA: ¥${avgCPA.toFixed(0)}`);

      // CPA上位5件
      const topCPA = [...crsWithCV].sort((a, b) => a.cpa - b.cpa).slice(0, 5);
      console.log('\nCPA上位5件（良い順）:');
      topCPA.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.crName} (${r.lpName}): CPA=¥${r.cpa.toFixed(0)}, CV=${r.cvCount}, 費用=¥${r.spend.toFixed(0)}`);
      });
    }

  } catch (error) {
    console.error('エラーが発生しました:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
