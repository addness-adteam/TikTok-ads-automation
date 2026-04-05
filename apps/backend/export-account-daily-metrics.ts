/**
 * セミナー用スキルプラス アカウント単位 日別メトリクス取得スクリプト
 *
 * 出力項目:
 * - 日付
 * - 広告費 (TikTok API)
 * - CV数 (スプレッドシート)
 * - CPA (広告費 / CV数)
 *
 * 期間: 2025年10月1日〜2025年12月31日
 */

import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// 環境変数読み込み
dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

// 設定
const ADVERTISER_ID = '7474920444831875080'; // セミナー用スキルプラスアカウント
const CV_SPREADSHEET_ID = '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk';
const TIKTOK_API_BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';

// 期間設定
const START_DATE = '2025-10-01';
const END_DATE = '2025-12-31';

// シート名
const CV_SHEET_NAME = 'TT_オプト';

// 期待される列名
const EXPECTED_COLUMNS = {
  registrationPath: ['登録経路', '流入経路', 'registration_path', 'path', 'ファネル登録経路'],
  date: ['登録日時', '登録日', 'date', 'created_at', 'timestamp', 'アクション実行日時', '実行日時'],
};

interface DailyMetrics {
  date: string;
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
 * 日付文字列からYYYY-MM-DD形式を取得
 */
function formatDateToYYYYMMDD(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * 日付文字列をパース
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
 * スプレッドシートから登録経路パターンにマッチする日別CV数をカウント
 * 登録経路: TikTok広告-スキルプラス-* に部分一致
 */
function countDailyRegistrations(
  sheetData: any[][],
  columnPositions: { registrationPath: number; date: number },
  targetDate: string,
): number {
  const targetDateObj = new Date(targetDate);
  const targetDateStr = formatDateToYYYYMMDD(targetDateObj);

  let count = 0;
  for (let i = 1; i < sheetData.length; i++) {
    const row = sheetData[i];
    const pathValue = row[columnPositions.registrationPath];
    const dateValue = row[columnPositions.date];

    if (!pathValue || !dateValue) continue;

    // 登録経路が「TikTok広告-スキルプラス-」で始まるかチェック
    if (!pathValue.toString().startsWith('TikTok広告-スキルプラス-')) continue;

    // 日付が一致するかチェック
    const rowDate = parseDate(dateValue);
    if (!rowDate) continue;

    const rowDateStr = formatDateToYYYYMMDD(rowDate);
    if (rowDateStr === targetDateStr) {
      count++;
    }
  }

  return count;
}

/**
 * TikTok APIからアクセストークンを取得
 */
async function getAccessToken(): Promise<string> {
  const token = await prisma.oAuthToken.findFirst({
    where: { advertiserId: ADVERTISER_ID },
  });

  if (!token) {
    throw new Error(`アクセストークンが見つかりません: ${ADVERTISER_ID}`);
  }

  return token.accessToken;
}

/**
 * 期間を30日ごとに分割
 */
function splitDateRange(startDate: string, endDate: string, maxDays: number = 30): Array<{ start: string; end: string }> {
  const ranges: Array<{ start: string; end: string }> = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  let currentStart = new Date(start);
  while (currentStart <= end) {
    const currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + maxDays - 1);

    if (currentEnd > end) {
      currentEnd.setTime(end.getTime());
    }

    ranges.push({
      start: formatDateToYYYYMMDD(currentStart),
      end: formatDateToYYYYMMDD(currentEnd),
    });

    currentStart = new Date(currentEnd);
    currentStart.setDate(currentStart.getDate() + 1);
  }

  return ranges;
}

/**
 * TikTok APIから日別広告費を取得（通常広告）
 * 広告レベルでデータを取得し、日付でグループ化
 * 30日制限に対応して期間を分割
 */
async function getRegularAdsDailySpend(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, number>> {
  const dailySpend = new Map<string, number>();

  // 30日ごとに期間を分割
  const dateRanges = splitDateRange(startDate, endDate, 30);
  console.log(`通常広告: ${dateRanges.length}回のAPIリクエストが必要`);

  for (const range of dateRanges) {
    let page = 1;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/report/integrated/get/`, {
        headers: { 'Access-Token': accessToken },
        params: {
          advertiser_id: ADVERTISER_ID,
          data_level: 'AUCTION_AD',
          report_type: 'BASIC',
          dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
          metrics: JSON.stringify(['spend']),
          start_date: range.start,
          end_date: range.end,
          page: page,
          page_size: pageSize,
        },
      });

      const list = response.data.data?.list || [];
      if (list.length > 0) {
        for (const record of list) {
          let dateStr = record.dimensions?.stat_time_day;
          const spend = parseFloat(record.metrics?.spend || '0');

          if (dateStr) {
            // "2025-10-18 00:00:00" -> "2025-10-18" に変換
            dateStr = dateStr.split(' ')[0];
            dailySpend.set(dateStr, (dailySpend.get(dateStr) || 0) + spend);
          }
        }

        const totalNumber = response.data.data?.page_info?.total_number || 0;
        const totalPages = Math.ceil(totalNumber / pageSize);
        hasMore = page < totalPages;
        page++;
      } else {
        hasMore = false;
      }
    }
  }

  console.log(`通常広告の日別データ取得: ${dailySpend.size}日分`);
  return dailySpend;
}

/**
 * TikTok APIからSmart+広告の日別広告費を取得
 * 30日制限に対応して期間を分割し、dimensionsを2つ以上指定
 */
async function getSmartPlusAdsDailySpend(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, number>> {
  const dailySpend = new Map<string, number>();

  // 30日ごとに期間を分割
  const dateRanges = splitDateRange(startDate, endDate, 30);
  console.log(`Smart+広告: ${dateRanges.length}回のAPIリクエストが必要`);

  for (const range of dateRanges) {
    try {
      let page = 1;
      const pageSize = 100;
      let hasMore = true;

      while (hasMore) {
        const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/material_report/overview/`, {
          headers: { 'Access-Token': accessToken },
          params: {
            advertiser_id: ADVERTISER_ID,
            dimensions: JSON.stringify(['smart_plus_ad_id', 'stat_time_day']),
            metrics: JSON.stringify(['spend']),
            start_date: range.start,
            end_date: range.end,
            page: page,
            page_size: pageSize,
          },
        });

        const list = response.data.data?.list || [];
        if (list.length > 0) {
          for (const record of list) {
            let dateStr = record.dimensions?.stat_time_day;
            const spend = parseFloat(record.metrics?.spend || '0');

            if (dateStr) {
              // "2025-10-18 00:00:00" -> "2025-10-18" に変換
              dateStr = dateStr.split(' ')[0];
              dailySpend.set(dateStr, (dailySpend.get(dateStr) || 0) + spend);
            }
          }

          const totalNumber = response.data.data?.page_info?.total_number || 0;
          const totalPages = Math.ceil(totalNumber / pageSize);
          hasMore = page < totalPages;
          page++;
        } else {
          hasMore = false;
        }
      }
    } catch (error: any) {
      console.error(`Smart+広告のデータ取得エラー (${range.start}〜${range.end}):`, error.response?.data || error.message);
    }
  }

  console.log(`Smart+広告の日別データ取得: ${dailySpend.size}日分`);
  return dailySpend;
}

/**
 * 日別広告費を合算
 */
function mergeDailySpend(regular: Map<string, number>, smartPlus: Map<string, number>): Map<string, number> {
  const merged = new Map<string, number>(regular);

  for (const [date, spend] of smartPlus.entries()) {
    merged.set(date, (merged.get(date) || 0) + spend);
  }

  return merged;
}

/**
 * 日付リストを生成
 */
function generateDateList(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    dates.push(formatDateToYYYYMMDD(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * CSVファイルに出力
 */
function exportToCSV(data: DailyMetrics[], outputPath: string): void {
  const headers = [
    '日付',
    '広告費',
    'CV数',
    'CPA',
  ];

  const rows = data.map(d => [
    d.date,
    d.spend.toFixed(2),
    d.cvCount,
    d.cpa === 0 ? '-' : d.cpa.toFixed(2),
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(',')),
  ].join('\n');

  // BOM付きUTF-8で保存（Excelで文字化けしないように）
  const bom = '\uFEFF';
  fs.writeFileSync(outputPath, bom + csvContent, 'utf-8');

  console.log(`CSVファイルを出力しました: ${outputPath}`);
}

/**
 * メイン処理
 */
async function main() {
  try {
    console.log('=== セミナー用スキルプラス アカウント単位 日別メトリクス取得 ===');
    console.log(`対象アカウント: ${ADVERTISER_ID}`);
    console.log(`期間: ${START_DATE} ~ ${END_DATE}`);

    // アクセストークン取得
    const accessToken = await getAccessToken();
    console.log('アクセストークン取得完了');

    // TikTok APIから日別広告費を取得
    console.log('\n広告費データを取得中...');
    const regularSpend = await getRegularAdsDailySpend(accessToken, START_DATE, END_DATE);
    const smartPlusSpend = await getSmartPlusAdsDailySpend(accessToken, START_DATE, END_DATE);
    const dailySpend = mergeDailySpend(regularSpend, smartPlusSpend);

    // スプレッドシートからデータを取得
    console.log('\nスプレッドシートデータを取得中...');
    const cvSheetData = await getSheetData(CV_SPREADSHEET_ID, CV_SHEET_NAME);

    if (cvSheetData.length === 0) {
      throw new Error('CVシートにデータがありません');
    }

    const cvColumnPositions = detectColumnPositions(cvSheetData[0]);
    console.log(`CV列位置: registrationPath=${cvColumnPositions.registrationPath}, date=${cvColumnPositions.date}`);

    // 日付リストを生成
    const dateList = generateDateList(START_DATE, END_DATE);
    console.log(`\n${dateList.length}日分のデータを処理中...`);

    // 日別メトリクスを計算
    const results: DailyMetrics[] = [];

    for (const date of dateList) {
      // 広告費
      const spend = dailySpend.get(date) || 0;

      // CV数
      const cvCount = countDailyRegistrations(cvSheetData, cvColumnPositions, date);

      // CPA計算
      const cpa = cvCount > 0 ? spend / cvCount : 0;

      results.push({
        date,
        spend,
        cvCount,
        cpa,
      });

      // 進捗表示（10日ごと）
      if (results.length % 10 === 0) {
        console.log(`  ${results.length}/${dateList.length}日処理完了...`);
      }
    }

    // CSV出力
    const outputDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, `セミナー用スキルプラス_日別メトリクス_${START_DATE}_${END_DATE}.csv`);
    exportToCSV(results, outputPath);

    // サマリー出力
    console.log('\n=== サマリー ===');
    const totalSpend = results.reduce((sum, r) => sum + r.spend, 0);
    const totalCV = results.reduce((sum, r) => sum + r.cvCount, 0);

    console.log(`総広告費: ¥${totalSpend.toLocaleString()}`);
    console.log(`総CV数: ${totalCV}`);
    if (totalCV > 0) {
      console.log(`平均CPA: ¥${(totalSpend / totalCV).toFixed(0)}`);
    }

  } catch (error) {
    console.error('エラーが発生しました:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
