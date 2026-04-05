/**
 * 特定広告の日別CPA、CTR、CPMエクスポートスクリプト
 *
 * 対象広告:
 * 1. 260113/鈴木織大/おーい会社員_今スキルプラスに入ること/LP2-CR00262
 * 2. 260113/鈴木織大/おーい会社員_今スキルプラスに入ること/LP2-CR00278
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
const ADVERTISER_ID = '7474920444831875080'; // スキルプラスセミナー導線アカウント
const CV_SPREADSHEET_ID = '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk';
const SHEET_NAME = 'TT_オプト';
const TIKTOK_API_BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';

// 対象広告名とTikTok広告ID
const TARGET_ADS = [
  {
    name: '260113/鈴木織大/おーい会社員_今スキルプラスに入ること/LP2-CR00262',
    tiktokId: '1854091284113730',
  },
  {
    name: '260113/鈴木織大/おーい会社員_今スキルプラスに入ること/LP2-CR00278',
    tiktokId: '1854629506067570',
  },
];

interface DailyMetric {
  date: string;
  adName: string;
  registrationPath: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpm: number;
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
 * TikTok APIからSmart+広告の日別メトリクスを取得（日付ごとにAPI呼び出し）
 * /v1.3/smart_plus/material_report/overview/ を使用
 * dimensionsには最低2つ必要なので、smart_plus_ad_idとmain_material_idを使用
 */
async function getSmartPlusAdDailyMetrics(
  accessToken: string,
  smartPlusAdIds: string[],
  startDate: string,
  endDate: string,
): Promise<Map<string, Map<string, { impressions: number; clicks: number; spend: number; conversions: number }>>> {
  // adId => date => metrics
  const result = new Map<string, Map<string, { impressions: number; clicks: number; spend: number; conversions: number }>>();

  // 日付のリストを生成
  const dates: string[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  console.log(`  取得対象日数: ${dates.length}日`);

  // 各日付ごとにAPIを呼び出す
  for (const date of dates) {
    try {
      // dimensionsには最低2つ必要: smart_plus_ad_id + main_material_id
      const params: any = {
        advertiser_id: ADVERTISER_ID,
        dimensions: JSON.stringify(['smart_plus_ad_id', 'main_material_id']),
        metrics: JSON.stringify(['impressions', 'clicks', 'spend', 'conversion']),
        start_date: date,
        end_date: date,
        page: 1,
        page_size: 100,
      };

      // 特定の広告IDでフィルタ
      if (smartPlusAdIds.length > 0) {
        params.filtering = JSON.stringify({
          smart_plus_ad_ids: smartPlusAdIds,
        });
      }

      const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/material_report/overview/`, {
        headers: { 'Access-Token': accessToken },
        params,
      });

      const list = response.data.data?.list || [];

      if (list.length > 0) {
        // smart_plus_ad_idごとに集計（同じ広告の複数クリエイティブを合算）
        for (const record of list) {
          const adId = record.dimensions?.smart_plus_ad_id;
          const metrics = record.metrics || {};

          if (adId) {
            if (!result.has(adId)) {
              result.set(adId, new Map());
            }
            const adMap = result.get(adId)!;

            const impressions = parseInt(metrics.impressions || '0', 10);
            const clicks = parseInt(metrics.clicks || '0', 10);
            const spend = parseFloat(metrics.spend || '0');
            const conversions = parseInt(metrics.conversion || '0', 10);

            // 同じ日付の同じ広告IDのデータを集計
            const existing = adMap.get(date) || { impressions: 0, clicks: 0, spend: 0, conversions: 0 };
            existing.impressions += impressions;
            existing.clicks += clicks;
            existing.spend += spend;
            existing.conversions += conversions;

            // データがある場合のみ追加
            if (existing.impressions > 0 || existing.spend > 0 || existing.clicks > 0) {
              adMap.set(date, existing);
            }
          }
        }
      }

      // レート制限対策: 少し待機
      await new Promise(resolve => setTimeout(resolve, 50));

    } catch (error: any) {
      // エラー時はスキップして続行
      if (error.response?.data?.code !== 40001) { // NO_DATA以外のエラーのみログ
        console.error(`  ${date}: エラー - ${error.response?.data?.message || error.message}`);
      }
    }
  }

  return result;
}

/**
 * 広告名から登録経路を生成
 */
function generateRegistrationPath(adName: string): string | null {
  const lpCrMatch = adName.match(/(LP\d+)[-_](CR\d+)/i);
  if (lpCrMatch) {
    return `TikTok広告-スキルプラス-${lpCrMatch[1]}-${lpCrMatch[2]}`;
  }
  return null;
}

// スプレッドシートキャッシュ
let cachedSheetData: any[][] | null = null;

/**
 * スプレッドシートから登録経路別・日別CV数を取得
 */
async function getDailyCVFromSpreadsheet(
  registrationPath: string,
): Promise<Map<string, number>> {
  const cvMap = new Map<string, number>();

  try {
    if (!cachedSheetData) {
      console.log('スプレッドシートデータを取得中...');
      cachedSheetData = await getSheetData(CV_SPREADSHEET_ID, SHEET_NAME);
    }

    const rows = cachedSheetData;

    if (!rows || rows.length === 0) {
      console.log('スプレッドシートにデータがありません');
      return cvMap;
    }

    // ヘッダー行から列位置を検出
    const headerRow = rows[0];
    let registrationPathCol = -1;
    let dateCol = -1;

    const pathHeaders = ['登録経路', '流入経路', 'registration_path', 'path', 'ファネル登録経路'];
    const dateHeaders = ['登録日時', '登録日', 'date', 'created_at', 'timestamp', 'アクション実行日時', '実行日時'];

    for (let i = 0; i < headerRow.length; i++) {
      const header = headerRow[i]?.toString().trim();
      if (pathHeaders.includes(header)) registrationPathCol = i;
      if (dateHeaders.includes(header)) dateCol = i;
    }

    if (registrationPathCol === -1) registrationPathCol = 4;
    if (dateCol === -1) dateCol = 5;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const pathValue = row[registrationPathCol];
      const dateValue = row[dateCol];

      if (!pathValue || !dateValue) continue;
      if (pathValue !== registrationPath) continue;

      // 日付をパース (YYYY-MM-DD形式に)
      const rowDate = new Date(dateValue);
      if (isNaN(rowDate.getTime())) continue;

      const dateKey = rowDate.toISOString().split('T')[0];
      cvMap.set(dateKey, (cvMap.get(dateKey) || 0) + 1);
    }

    console.log(`  登録経路「${registrationPath}」のCV数: ${Array.from(cvMap.values()).reduce((a, b) => a + b, 0)}`);

  } catch (error) {
    console.error(`CV数取得エラー (${registrationPath}):`, error);
  }

  return cvMap;
}

/**
 * CSVファイルに出力
 */
function exportToCSV(data: DailyMetric[], outputPath: string): void {
  const headers = [
    '日付',
    '広告名',
    '登録経路',
    'インプレッション',
    'クリック数',
    '消化額',
    'CV数',
    'CTR(%)',
    'CPM',
    'CPA',
  ];

  const rows = data.map(d => [
    d.date,
    `"${d.adName.replace(/"/g, '""')}"`,
    `"${d.registrationPath.replace(/"/g, '""')}"`,
    d.impressions,
    d.clicks,
    d.spend.toFixed(2),
    d.conversions,
    d.ctr.toFixed(4),
    d.cpm.toFixed(2),
    d.conversions > 0 ? d.cpa.toFixed(2) : '-',
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
    console.log('=== 特定広告 日別メトリクスエクスポート ===');
    console.log(`対象アカウント: ${ADVERTISER_ID}`);
    console.log(`対象広告:`);
    TARGET_ADS.forEach(ad => console.log(`  - ${ad.name} (ID: ${ad.tiktokId})`));

    // アクセストークン取得
    const accessToken = await getAccessToken();
    console.log('アクセストークン取得完了');

    // 日別メトリクスを取得（2026年1月から）
    const startDate = '2026-01-01';
    const endDate = new Date().toISOString().split('T')[0];
    console.log(`\nレポート取得期間: ${startDate} ~ ${endDate}`);

    // 全対象広告のIDリスト
    const smartPlusAdIds = TARGET_ADS.map(ad => ad.tiktokId);

    console.log('\nSmart+広告の日別メトリクスを取得中...');
    const allDailyMetrics = await getSmartPlusAdDailyMetrics(accessToken, smartPlusAdIds, startDate, endDate);

    console.log(`取得した広告数: ${allDailyMetrics.size}`);

    // 取得したデータの確認
    for (const [adId, dateMap] of allDailyMetrics.entries()) {
      console.log(`  広告ID ${adId}: ${dateMap.size}日分のデータ`);
    }

    const results: DailyMetric[] = [];

    for (const targetAd of TARGET_ADS) {
      console.log(`\n処理中: ${targetAd.name}`);

      const registrationPath = generateRegistrationPath(targetAd.name) || '';
      console.log(`  登録経路: ${registrationPath}`);

      const dailyMetrics = allDailyMetrics.get(targetAd.tiktokId) || new Map();
      console.log(`  API日別データ: ${dailyMetrics.size} 日分`);

      // スプレッドシートからCV数を取得
      const cvData = await getDailyCVFromSpreadsheet(registrationPath);

      // 結果をマージ
      const allDates = new Set([...dailyMetrics.keys(), ...cvData.keys()]);
      const sortedDates = Array.from(allDates).sort();

      for (const date of sortedDates) {
        const apiMetrics = dailyMetrics.get(date) || { impressions: 0, clicks: 0, spend: 0, conversions: 0 };
        const cvCount = cvData.get(date) || 0;

        // 配信データがない日はスキップ
        if (apiMetrics.spend === 0 && apiMetrics.impressions === 0 && cvCount === 0) {
          continue;
        }

        const ctr = apiMetrics.impressions > 0 ? (apiMetrics.clicks / apiMetrics.impressions) * 100 : 0;
        const cpm = apiMetrics.impressions > 0 ? (apiMetrics.spend / apiMetrics.impressions) * 1000 : 0;
        const cpa = cvCount > 0 ? apiMetrics.spend / cvCount : 0;

        results.push({
          date,
          adName: targetAd.name,
          registrationPath,
          impressions: apiMetrics.impressions,
          clicks: apiMetrics.clicks,
          spend: apiMetrics.spend,
          conversions: cvCount,
          ctr,
          cpm,
          cpa,
        });
      }
    }

    // 広告名、日付順にソート
    results.sort((a, b) => {
      if (a.adName !== b.adName) return a.adName.localeCompare(b.adName);
      return a.date.localeCompare(b.date);
    });

    // CSV出力
    const outputDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const outputPath = path.join(outputDir, `特定広告_日別メトリクス_${timestamp}.csv`);

    exportToCSV(results, outputPath);

    // サマリー出力
    console.log('\n=== サマリー ===');
    for (const targetAd of TARGET_ADS) {
      const adResults = results.filter(r => r.adName === targetAd.name);
      if (adResults.length > 0) {
        const totalSpend = adResults.reduce((sum, r) => sum + r.spend, 0);
        const totalCV = adResults.reduce((sum, r) => sum + r.conversions, 0);
        const totalImpressions = adResults.reduce((sum, r) => sum + r.impressions, 0);
        const totalClicks = adResults.reduce((sum, r) => sum + r.clicks, 0);
        const avgCPA = totalCV > 0 ? totalSpend / totalCV : 0;
        const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
        const avgCPM = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;

        console.log(`\n${targetAd.name}`);
        console.log(`  配信日数: ${adResults.length} 日`);
        console.log(`  配信期間: ${adResults[0].date} ~ ${adResults[adResults.length - 1].date}`);
        console.log(`  総消化額: ¥${totalSpend.toLocaleString()}`);
        console.log(`  総CV数: ${totalCV}`);
        console.log(`  平均CPA: ${totalCV > 0 ? '¥' + avgCPA.toFixed(0) : '-'}`);
        console.log(`  平均CTR: ${avgCTR.toFixed(2)}%`);
        console.log(`  平均CPM: ¥${avgCPM.toFixed(0)}`);
      }
    }

  } catch (error) {
    console.error('エラーが発生しました:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
