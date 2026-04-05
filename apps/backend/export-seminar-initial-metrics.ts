/**
 * セミナー導線 初動（配信開始から3日間）メトリクス算出スクリプト
 *
 * 出力項目:
 * - 配信開始日
 * - 初動3日間のインプレッション (TikTok API)
 * - 初動3日間のクリック数 (TikTok API)
 * - 初動3日間の費用 (TikTok API)
 * - 初動3日間のCTR (TikTok API)
 * - 初動3日間のCPM (TikTok API)
 * - 初動3日間のCV数 (スプレッドシート)
 * - 初動3日間のCVR (CV数 / クリック数)
 * - 初動3日間のCPA (費用 / CV数)
 */

import { google } from 'googleapis';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// 環境変数読み込み
dotenv.config({ path: path.join(__dirname, '.env') });

// 設定
const ADVERTISER_ID = '7474920444831875080'; // セミナー導線アカウント
const CV_SPREADSHEET_ID = '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk';
const SHEET_NAME = 'TT_オプト';
const TIKTOK_API_BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';

// 初動期間の日数
const INITIAL_PERIOD_DAYS = 3;

// 期待される列名
const EXPECTED_COLUMNS = {
  registrationPath: ['登録経路', '流入経路', 'registration_path', 'path', 'ファネル登録経路'],
  date: ['登録日時', '登録日', 'date', 'created_at', 'timestamp', 'アクション実行日時', '実行日時'],
};

interface AdInitialMetrics {
  adId: string;
  adName: string;
  adType: string;
  registrationPath: string;
  startDate: string;
  endDate: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpm: number;
  cvCount: number;
  cvr: number;
  cpa: number;
}

interface DailyMetric {
  adId: string;
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
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
 * スプレッドシートデータを一度だけ取得してキャッシュ
 */
async function loadSheetDataOnce(): Promise<{
  rows: any[][];
  columnPositions: { registrationPath: number; date: number };
}> {
  if (cachedSheetData && cachedColumnPositions) {
    return { rows: cachedSheetData, columnPositions: cachedColumnPositions };
  }

  console.log('スプレッドシートデータを取得中...');
  const rows = await getSheetData(CV_SPREADSHEET_ID, SHEET_NAME);

  if (!rows || rows.length === 0) {
    throw new Error(`シートにデータがありません: ${SHEET_NAME}`);
  }

  const columnPositions = detectColumnPositions(rows[0]);
  console.log(`列位置: registrationPath=${columnPositions.registrationPath}, date=${columnPositions.date}`);
  console.log(`ヘッダー行: ${rows[0].join(', ')}`);

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
 * TikTok APIからアクセストークンを取得（環境変数から）
 */
function getAccessToken(): string {
  const token = process.env.TIKTOK_ACCESS_TOKEN;

  if (!token) {
    throw new Error('環境変数 TIKTOK_ACCESS_TOKEN が設定されていません');
  }

  return token;
}

/**
 * TikTok APIから通常広告一覧を取得
 */
async function getRegularAds(accessToken: string): Promise<any[]> {
  const allAds: any[] = [];
  let page = 1;
  const pageSize = 100;
  let hasMore = true;

  while (hasMore) {
    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/ad/get/`, {
      headers: { 'Access-Token': accessToken },
      params: {
        advertiser_id: ADVERTISER_ID,
        page_size: pageSize,
        page: page,
      },
    });

    const list = response.data.data?.list || [];
    if (list.length > 0) {
      allAds.push(...list.map((ad: any) => ({ ...ad, adType: 'REGULAR' })));
      const totalNumber = response.data.data?.page_info?.total_number || 0;
      const totalPages = Math.ceil(totalNumber / pageSize);
      hasMore = page < totalPages;
      page++;
    } else {
      hasMore = false;
    }
  }

  console.log(`通常広告数: ${allAds.length}`);
  return allAds;
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
            ad_name: ad.smart_plus_ad_name,
            adType: 'SMART_PLUS',
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
      console.error('Smart+広告取得エラー:', error.response?.data || error.message);
      hasMore = false;
    }
  }

  console.log(`Smart+広告数: ${allAds.length}`);
  return allAds;
}

/**
 * TikTok APIから全広告一覧を取得（通常+Smart+）
 */
async function getAllAds(accessToken: string): Promise<any[]> {
  const regularAds = await getRegularAds(accessToken);
  const smartPlusAds = await getSmartPlusAds(accessToken);

  const allAds = [...regularAds, ...smartPlusAds];
  console.log(`取得した広告数（合計）: ${allAds.length}`);
  return allAds;
}

/**
 * 期間を30日ずつに分割
 */
function splitDateRange(startDate: string, endDate: string): { start: string; end: string }[] {
  const ranges: { start: string; end: string }[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  let current = new Date(start);

  while (current < end) {
    const rangeStart = formatDate(current);
    current = addDays(current, 29); // 30日間（開始日含む）
    if (current > end) {
      current = new Date(end);
    }
    const rangeEnd = formatDate(current);
    ranges.push({ start: rangeStart, end: rangeEnd });
    current = addDays(current, 1); // 次の範囲の開始日
  }

  return ranges;
}

/**
 * TikTok APIから通常広告の日別メトリクスを取得（30日ずつ分割）
 */
async function getRegularAdDailyMetrics(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<DailyMetric[]> {
  const allMetrics: DailyMetric[] = [];

  // 30日ずつに分割
  const dateRanges = splitDateRange(startDate, endDate);
  console.log(`通常広告: ${dateRanges.length}回のAPIリクエストに分割`);

  for (const range of dateRanges) {
    let page = 1;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const params = {
        advertiser_id: ADVERTISER_ID,
        data_level: 'AUCTION_AD',
        report_type: 'BASIC',
        dimensions: JSON.stringify(['stat_time_day', 'ad_id']),
        metrics: JSON.stringify(['impressions', 'clicks', 'spend']),
        start_date: range.start,
        end_date: range.end,
        page: page,
        page_size: pageSize,
      };

      const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/report/integrated/get/`, {
        headers: { 'Access-Token': accessToken },
        params,
      });

      if (response.data.code !== 0) {
        console.error(`API Error: ${response.data.message}`);
        break;
      }

      const list = response.data.data?.list || [];
      if (list.length > 0) {
        for (const record of list) {
          const adId = record.dimensions?.ad_id;
          const statDate = record.dimensions?.stat_time_day;
          const metrics = record.metrics || {};

          if (adId && statDate) {
            allMetrics.push({
              adId,
              date: statDate.split(' ')[0],
              impressions: parseInt(metrics.impressions || '0', 10),
              clicks: parseInt(metrics.clicks || '0', 10),
              spend: parseFloat(metrics.spend || '0'),
            });
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

    console.log(`  ${range.start} ~ ${range.end}: ${allMetrics.length}件累計`);
  }

  console.log(`通常広告日別メトリクス数: ${allMetrics.length}`);
  return allMetrics;
}

/**
 * TikTok APIからSmart+広告の日別メトリクスを取得（30日ずつ分割）
 */
async function getSmartPlusAdDailyMetrics(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<DailyMetric[]> {
  const allMetrics: DailyMetric[] = [];

  // 30日ずつに分割
  const dateRanges = splitDateRange(startDate, endDate);
  console.log(`Smart+広告: ${dateRanges.length}回のAPIリクエストに分割`);

  for (const range of dateRanges) {
    let page = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      try {
        const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/material_report/overview/`, {
          headers: { 'Access-Token': accessToken },
          params: {
            advertiser_id: ADVERTISER_ID,
            dimensions: JSON.stringify(['smart_plus_ad_id', 'stat_time_day']),
            metrics: JSON.stringify(['impressions', 'clicks', 'spend']),
            start_date: range.start,
            end_date: range.end,
            page: page,
            page_size: pageSize,
          },
        });

        const list = response.data.data?.list || [];
        if (list.length > 0) {
          for (const record of list) {
            const adId = record.dimensions?.smart_plus_ad_id;
            const statDate = record.dimensions?.stat_time_day;
            const metrics = record.metrics || {};

            if (adId && statDate) {
              allMetrics.push({
                adId,
                date: statDate.split(' ')[0],
                impressions: parseInt(metrics.impressions || '0', 10),
                clicks: parseInt(metrics.clicks || '0', 10),
                spend: parseFloat(metrics.spend || '0'),
              });
            }
          }

          const totalNumber = response.data.data?.page_info?.total_number || 0;
          const totalPages = Math.ceil(totalNumber / pageSize);
          hasMore = page < totalPages;
          page++;
        } else {
          hasMore = false;
        }
      } catch (error: any) {
        console.error('Smart+日別メトリクス取得エラー:', error.response?.data || error.message);
        hasMore = false;
      }
    }

    console.log(`  ${range.start} ~ ${range.end}: ${allMetrics.length}件累計`);
  }

  console.log(`Smart+広告日別メトリクス数: ${allMetrics.length}`);
  return allMetrics;
}

/**
 * 広告ごとの配信開始日を特定
 */
function getAdStartDates(dailyMetrics: DailyMetric[]): Map<string, string> {
  const startDates = new Map<string, string>();

  for (const metric of dailyMetrics) {
    // インプレッションがある日のみを考慮
    if (metric.impressions > 0) {
      const currentStartDate = startDates.get(metric.adId);
      if (!currentStartDate || metric.date < currentStartDate) {
        startDates.set(metric.adId, metric.date);
      }
    }
  }

  return startDates;
}

/**
 * 広告ごとの初動3日間のメトリクスを集計
 */
function aggregateInitialMetrics(
  dailyMetrics: DailyMetric[],
  startDates: Map<string, string>,
): Map<string, { impressions: number; clicks: number; spend: number; startDate: string; endDate: string }> {
  const aggregated = new Map<string, { impressions: number; clicks: number; spend: number; startDate: string; endDate: string }>();

  for (const metric of dailyMetrics) {
    const startDateStr = startDates.get(metric.adId);
    if (!startDateStr) continue;

    const startDate = new Date(startDateStr);
    const endDate = addDays(startDate, INITIAL_PERIOD_DAYS - 1); // 3日間（開始日含む）
    const metricDate = new Date(metric.date);

    // 初動3日間のデータのみを集計
    if (metricDate >= startDate && metricDate <= endDate) {
      const existing = aggregated.get(metric.adId) || {
        impressions: 0,
        clicks: 0,
        spend: 0,
        startDate: startDateStr,
        endDate: formatDate(endDate),
      };

      existing.impressions += metric.impressions;
      existing.clicks += metric.clicks;
      existing.spend += metric.spend;

      aggregated.set(metric.adId, existing);
    }
  }

  return aggregated;
}

/**
 * 広告名から登録経路を生成
 */
function generateRegistrationPath(adName: string): string | null {
  // パターン1: LP名-CR名 の形式 (例: LP2-CR00004)
  const lpCrMatch = adName.match(/(LP\d+)[-_](CR\d+)/i);
  if (lpCrMatch) {
    return `TikTok広告-スキルプラス-${lpCrMatch[1]}-${lpCrMatch[2]}`;
  }

  // パターン2: CR番号のみ (例: CR00004) - デフォルトでLP2
  const crOnlyMatch = adName.match(/CR(\d{5})/i);
  if (crOnlyMatch) {
    return `TikTok広告-スキルプラス-LP2-CR${crOnlyMatch[1]}`;
  }

  // パターン3: スラッシュ区切りの場合、最後の部分をチェック
  const parts = adName.split('/');
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const lpCrMatch2 = lastPart.match(/(LP\d+)[-_]?(CR\d+)?/i);
    if (lpCrMatch2) {
      const lpName = lpCrMatch2[1];
      const crName = lpCrMatch2[2] || '';
      if (crName) {
        return `TikTok広告-スキルプラス-${lpName}-${crName}`;
      }
    }
  }

  return null;
}

/**
 * CSVファイルに出力
 */
function exportToCSV(data: AdInitialMetrics[], outputPath: string): void {
  const headers = [
    '広告ID',
    '広告名',
    '広告タイプ',
    '登録経路',
    '配信開始日',
    '初動終了日',
    'インプレッション',
    'クリック数',
    '費用',
    'CTR(%)',
    'CPM',
    'CV数',
    'CVR(%)',
    'CPA',
  ];

  const rows = data.map(d => [
    d.adId,
    `"${d.adName.replace(/"/g, '""')}"`,
    d.adType,
    `"${d.registrationPath.replace(/"/g, '""')}"`,
    d.startDate,
    d.endDate,
    d.impressions,
    d.clicks,
    d.spend.toFixed(2),
    d.ctr.toFixed(2),
    d.cpm.toFixed(2),
    d.cvCount,
    d.cvr.toFixed(2),
    d.cpa.toFixed(2),
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
    console.log('=== セミナー導線 初動3日間メトリクス算出 ===');
    console.log(`対象アカウント: ${ADVERTISER_ID}`);
    console.log(`CVスプレッドシートID: ${CV_SPREADSHEET_ID}`);
    console.log(`初動期間: ${INITIAL_PERIOD_DAYS}日間`);

    // 過去3ヶ月の期間を計算
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 3);

    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    console.log(`対象期間: ${startDateStr} ~ ${endDateStr}`);

    // アクセストークン取得（環境変数から）
    const accessToken = getAccessToken();
    console.log('アクセストークン取得完了');

    // 広告一覧取得
    const ads = await getAllAds(accessToken);

    // 日別メトリクス取得
    console.log('\n日別メトリクスを取得中...');
    const regularDailyMetrics = await getRegularAdDailyMetrics(accessToken, startDateStr, endDateStr);
    const smartPlusDailyMetrics = await getSmartPlusAdDailyMetrics(accessToken, startDateStr, endDateStr);
    const allDailyMetrics = [...regularDailyMetrics, ...smartPlusDailyMetrics];

    // 広告ごとの配信開始日を特定
    console.log('\n配信開始日を特定中...');
    const adStartDates = getAdStartDates(allDailyMetrics);
    console.log(`配信開始日が特定できた広告数: ${adStartDates.size}`);

    // 初動3日間のメトリクスを集計
    console.log('\n初動3日間のメトリクスを集計中...');
    const initialMetrics = aggregateInitialMetrics(allDailyMetrics, adStartDates);

    // 結果を格納
    const results: AdInitialMetrics[] = [];

    // 登録経路パターンにマッチした広告のみをフィルタ
    const matchedAds = ads.filter(ad => {
      const adName = ad.ad_name || ad.smart_plus_ad_name || '';
      return generateRegistrationPath(adName) !== null;
    });

    console.log(`\n登録経路パターンにマッチした広告数: ${matchedAds.length} / ${ads.length}`);

    // 過去3ヶ月以内に配信開始した広告のみをフィルタ
    const recentAds = matchedAds.filter(ad => {
      const adId = ad.ad_id || ad.smart_plus_ad_id;
      const startDateStr = adStartDates.get(adId);
      if (!startDateStr) return false;

      const adStartDate = new Date(startDateStr);
      return adStartDate >= startDate;
    });

    console.log(`過去3ヶ月以内に配信開始した広告数: ${recentAds.length}`);

    // 各広告のCV数を取得して計算
    console.log('\n各広告の初動3日間CV数を取得中...');

    for (const ad of recentAds) {
      const adId = ad.ad_id || ad.smart_plus_ad_id;
      const adName = ad.ad_name || ad.smart_plus_ad_name || '';
      const adType = ad.adType || 'REGULAR';

      // 登録経路を生成
      const registrationPath = generateRegistrationPath(adName);
      if (!registrationPath) continue;

      // 初動3日間のメトリクス
      const metrics = initialMetrics.get(adId);
      if (!metrics) {
        console.log(`  [スキップ] ${adName}: 初動メトリクスなし`);
        continue;
      }

      // 初動3日間のCV数をスプレッドシートから取得
      const cvStartDate = new Date(metrics.startDate);
      const cvEndDate = new Date(metrics.endDate);
      // 終了日の23:59:59まで含める
      cvEndDate.setHours(23, 59, 59, 999);

      const cvCount = await countCVFromSpreadsheet(
        registrationPath,
        cvStartDate,
        cvEndDate,
      );

      // CTR、CPM、CVR、CPA計算
      const ctr = metrics.impressions > 0 ? (metrics.clicks / metrics.impressions) * 100 : 0;
      const cpm = metrics.impressions > 0 ? (metrics.spend / metrics.impressions) * 1000 : 0;
      const cvr = metrics.clicks > 0 ? (cvCount / metrics.clicks) * 100 : 0;
      const cpa = cvCount > 0 ? metrics.spend / cvCount : 0;

      results.push({
        adId,
        adName,
        adType,
        registrationPath,
        startDate: metrics.startDate,
        endDate: metrics.endDate,
        impressions: metrics.impressions,
        clicks: metrics.clicks,
        spend: metrics.spend,
        ctr,
        cpm,
        cvCount,
        cvr,
        cpa,
      });

      console.log(`  [${adType}] ${adName}`);
      console.log(`    配信開始: ${metrics.startDate} ~ ${metrics.endDate}`);
      console.log(`    インプレ=${metrics.impressions.toLocaleString()}, クリック=${metrics.clicks}, CV=${cvCount}`);
      console.log(`    CTR=${ctr.toFixed(2)}%, CPM=¥${cpm.toFixed(0)}, CVR=${cvr.toFixed(2)}%, CPA=¥${cpa.toFixed(0)}`);
    }

    // 配信開始日でソート（新しい順）
    results.sort((a, b) => b.startDate.localeCompare(a.startDate));

    // CSV出力
    const outputDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const outputPath = path.join(outputDir, `セミナー導線_初動3日間メトリクス_${timestamp}.csv`);

    exportToCSV(results, outputPath);

    // サマリー出力
    console.log('\n=== サマリー ===');
    console.log(`総広告数: ${results.length}`);
    console.log(`総インプレッション: ${results.reduce((sum, r) => sum + r.impressions, 0).toLocaleString()}`);
    console.log(`総クリック数: ${results.reduce((sum, r) => sum + r.clicks, 0).toLocaleString()}`);
    console.log(`総費用: ¥${results.reduce((sum, r) => sum + r.spend, 0).toLocaleString()}`);
    console.log(`総CV数: ${results.reduce((sum, r) => sum + r.cvCount, 0)}`);

    const totalClicks = results.reduce((sum, r) => sum + r.clicks, 0);
    const totalCV = results.reduce((sum, r) => sum + r.cvCount, 0);
    const totalSpend = results.reduce((sum, r) => sum + r.spend, 0);
    const totalImpressions = results.reduce((sum, r) => sum + r.impressions, 0);

    if (totalImpressions > 0) {
      console.log(`平均CTR: ${((totalClicks / totalImpressions) * 100).toFixed(2)}%`);
      console.log(`平均CPM: ¥${((totalSpend / totalImpressions) * 1000).toFixed(0)}`);
    }
    if (totalClicks > 0) {
      console.log(`平均CVR: ${((totalCV / totalClicks) * 100).toFixed(2)}%`);
    }
    if (totalCV > 0) {
      console.log(`平均CPA: ¥${(totalSpend / totalCV).toFixed(0)}`);
    }

  } catch (error) {
    console.error('エラーが発生しました:', error);
    throw error;
  }
}

main();
