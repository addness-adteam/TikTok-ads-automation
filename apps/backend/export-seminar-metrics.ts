/**
 * セミナー導線 直近3ヶ月 広告別メトリクス算出スクリプト
 *
 * 出力項目:
 * - CTR (TikTok API)
 * - CPM (TikTok API)
 * - クリック数 (TikTok API)
 * - 費用 (TikTok API)
 * - CV数 (スプレッドシート)
 * - CVR (CV数 / クリック数)
 * - CPA (費用 / CV数)
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
const ADVERTISER_ID = '7474920444831875080'; // セミナー導線アカウント
const CV_SPREADSHEET_ID = '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk';
const SHEET_NAME = 'TT_オプト';
const TIKTOK_API_BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';

// 期待される列名
const EXPECTED_COLUMNS = {
  registrationPath: ['登録経路', '流入経路', 'registration_path', 'path', 'ファネル登録経路'],
  date: ['登録日時', '登録日', 'date', 'created_at', 'timestamp', 'アクション実行日時', '実行日時'],
};

interface AdMetrics {
  adId: string;
  adName: string;
  adType: string;
  registrationPath: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpm: number;
  cvCount: number;
  cvr: number;
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

  // ユニークな登録経路を表示
  const uniquePaths = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const pathValue = rows[i][columnPositions.registrationPath];
    if (pathValue && pathValue.toString().includes('スキルプラス')) {
      uniquePaths.add(pathValue);
    }
  }
  console.log(`\nスプレッドシート内の「スキルプラス」を含む登録経路 (${uniquePaths.size}件):`);
  Array.from(uniquePaths).slice(0, 20).forEach(p => console.log(`  - ${p}`));
  if (uniquePaths.size > 20) {
    console.log(`  ... 他 ${uniquePaths.size - 20} 件`);
  }

  return { rows, columnPositions };
}

/**
 * スプレッドシートから登録経路のCV数をカウント（キャッシュ使用）
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
        // Smart+広告の構造を通常広告に合わせて変換
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
 * TikTok APIから通常広告メトリクスを取得
 */
async function getRegularAdMetrics(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, { impressions: number; clicks: number; spend: number; ctr: number; cpm: number }>> {
  const metricsMap = new Map();
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
        dimensions: JSON.stringify(['ad_id']),
        metrics: JSON.stringify(['impressions', 'clicks', 'spend', 'ctr', 'cpm']),
        start_date: startDate,
        end_date: endDate,
        page: page,
        page_size: pageSize,
      },
    });

    const list = response.data.data?.list || [];
    if (list.length > 0) {
      for (const record of list) {
        const adId = record.dimensions?.ad_id;
        const metrics = record.metrics || {};

        if (adId) {
          const existing = metricsMap.get(adId) || {
            impressions: 0,
            clicks: 0,
            spend: 0,
            ctr: 0,
            cpm: 0,
          };

          existing.impressions += parseInt(metrics.impressions || '0', 10);
          existing.clicks += parseInt(metrics.clicks || '0', 10);
          existing.spend += parseFloat(metrics.spend || '0');

          metricsMap.set(adId, existing);
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

  // CTR、CPMを再計算（集計後）
  for (const [adId, metrics] of metricsMap.entries()) {
    if (metrics.impressions > 0) {
      metrics.ctr = (metrics.clicks / metrics.impressions) * 100;
      metrics.cpm = (metrics.spend / metrics.impressions) * 1000;
    }
    metricsMap.set(adId, metrics);
  }

  console.log(`通常広告メトリクス数: ${metricsMap.size}`);
  return metricsMap;
}

/**
 * TikTok APIからSmart+広告メトリクスを取得
 */
async function getSmartPlusAdMetrics(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, { impressions: number; clicks: number; spend: number; ctr: number; cpm: number }>> {
  const metricsMap = new Map();
  let page = 1;
  const pageSize = 100;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/material_report/overview/`, {
        headers: { 'Access-Token': accessToken },
        params: {
          advertiser_id: ADVERTISER_ID,
          dimensions: JSON.stringify(['smart_plus_ad_id']),
          metrics: JSON.stringify(['impressions', 'clicks', 'spend', 'ctr', 'cpm']),
          start_date: startDate,
          end_date: endDate,
          page: page,
          page_size: pageSize,
        },
      });

      const list = response.data.data?.list || [];
      if (list.length > 0) {
        for (const record of list) {
          const adId = record.dimensions?.smart_plus_ad_id;
          const metrics = record.metrics || {};

          if (adId) {
            const existing = metricsMap.get(adId) || {
              impressions: 0,
              clicks: 0,
              spend: 0,
              ctr: 0,
              cpm: 0,
            };

            existing.impressions += parseInt(metrics.impressions || '0', 10);
            existing.clicks += parseInt(metrics.clicks || '0', 10);
            existing.spend += parseFloat(metrics.spend || '0');

            metricsMap.set(adId, existing);
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
      console.error('Smart+メトリクス取得エラー:', error.response?.data || error.message);
      hasMore = false;
    }
  }

  // CTR、CPMを再計算（集計後）
  for (const [adId, metrics] of metricsMap.entries()) {
    if (metrics.impressions > 0) {
      metrics.ctr = (metrics.clicks / metrics.impressions) * 100;
      metrics.cpm = (metrics.spend / metrics.impressions) * 1000;
    }
    metricsMap.set(adId, metrics);
  }

  console.log(`Smart+広告メトリクス数: ${metricsMap.size}`);
  return metricsMap;
}

/**
 * TikTok APIから全広告メトリクスを取得（通常+Smart+）
 */
async function getAdMetrics(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, { impressions: number; clicks: number; spend: number; ctr: number; cpm: number }>> {
  const regularMetrics = await getRegularAdMetrics(accessToken, startDate, endDate);
  const smartPlusMetrics = await getSmartPlusAdMetrics(accessToken, startDate, endDate);

  // マージ
  const metricsMap = new Map(regularMetrics);
  for (const [adId, metrics] of smartPlusMetrics.entries()) {
    metricsMap.set(adId, metrics);
  }

  console.log(`取得したメトリクス数（合計）: ${metricsMap.size}`);
  return metricsMap;
}

/**
 * 広告名から登録経路を生成
 * フォーマット: TikTok広告-スキルプラス-{LP名}-{CR名}
 *
 * 広告名の例:
 * - 2024.01.15/田中/新春キャンペーン/LP2-CR00004 → TikTok広告-スキルプラス-LP2-CR00004
 * - LP2-CR00004_セミナー動画 → TikTok広告-スキルプラス-LP2-CR00004
 * - CR00004 → TikTok広告-スキルプラス-LP2-CR00004 (デフォルトでLP2)
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

  // パターンに一致しない場合はnullを返す（マッチしない広告はスキップ）
  return null;
}

/**
 * CSVファイルに出力
 */
function exportToCSV(data: AdMetrics[], outputPath: string): void {
  const headers = [
    '広告ID',
    '広告名',
    '広告タイプ',
    '登録経路',
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
    `"${d.adName.replace(/"/g, '""')}"`, // CSVエスケープ
    d.adType,
    `"${d.registrationPath.replace(/"/g, '""')}"`,
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
    console.log('=== セミナー導線 広告メトリクス算出 ===');
    console.log(`対象アカウント: ${ADVERTISER_ID}`);
    console.log(`CVスプレッドシートID: ${CV_SPREADSHEET_ID}`);

    // 直近3ヶ月の期間を計算
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 3);

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    console.log(`期間: ${startDateStr} ~ ${endDateStr}`);

    // アクセストークン取得
    const accessToken = await getAccessToken();
    console.log('アクセストークン取得完了');

    // 広告一覧取得
    const ads = await getAllAds(accessToken);

    // メトリクス取得
    const metricsMap = await getAdMetrics(accessToken, startDateStr, endDateStr);

    // 結果を格納
    const results: AdMetrics[] = [];

    // 登録経路パターンにマッチした広告のみをフィルタ
    const matchedAds = ads.filter(ad => {
      const adName = ad.ad_name || ad.smart_plus_ad_name || '';
      return generateRegistrationPath(adName) !== null;
    });

    console.log(`\n登録経路パターンにマッチした広告数: ${matchedAds.length} / ${ads.length}`);

    // 各広告のCV数を取得して計算
    console.log('\n各広告のCV数を取得中...');

    for (const ad of matchedAds) {
      const adId = ad.ad_id || ad.smart_plus_ad_id;
      const adName = ad.ad_name || ad.smart_plus_ad_name || '';
      const adType = ad.adType || 'REGULAR';

      // 登録経路を生成
      const registrationPath = generateRegistrationPath(adName);

      if (!registrationPath) {
        continue;
      }

      // TikTok APIからのメトリクス
      const apiMetrics = metricsMap.get(adId) || {
        impressions: 0,
        clicks: 0,
        spend: 0,
        ctr: 0,
        cpm: 0,
      };

      // スプレッドシートからCV数取得
      const cvCount = await countCVFromSpreadsheet(
        registrationPath,
        startDate,
        endDate,
      );

      // CVR、CPA計算
      const cvr = apiMetrics.clicks > 0 ? (cvCount / apiMetrics.clicks) * 100 : 0;
      const cpa = cvCount > 0 ? apiMetrics.spend / cvCount : 0;

      results.push({
        adId,
        adName,
        adType,
        registrationPath,
        impressions: apiMetrics.impressions,
        clicks: apiMetrics.clicks,
        spend: apiMetrics.spend,
        ctr: apiMetrics.ctr,
        cpm: apiMetrics.cpm,
        cvCount,
        cvr,
        cpa,
      });

      console.log(`  [${adType}] ${adName}: クリック=${apiMetrics.clicks}, CV=${cvCount}, CVR=${cvr.toFixed(2)}%, CPA=¥${cpa.toFixed(0)}`);
    }

    // CSV出力
    const outputDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const outputPath = path.join(outputDir, `セミナー導線_広告メトリクス_${timestamp}.csv`);

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

    if (totalClicks > 0) {
      console.log(`平均CVR: ${((totalCV / totalClicks) * 100).toFixed(2)}%`);
    }
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
