/**
 * AI導線 CR別初動3日間CPA算出スクリプト
 *
 * 対象: AI導線アカウント（2025年12月以降出稿分）
 * ※ TikTok APIのデータ保持期間制限のため、2025年12月以降の広告のみ対象
 *
 * 出力項目:
 * - 広告ID
 * - 広告名
 * - アカウント名
 * - 出稿日
 * - 初動3日間の費用 (TikTok API - Smart+)
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

// AI導線アカウント設定
const AI_ADVERTISERS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
];

// CVスプレッドシート設定
const CV_SPREADSHEET_ID = '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk';
const SHEET_NAME = 'TT_オプト';

// 初動期間の日数
const INITIAL_PERIOD_DAYS = 3;

// 対象期間の開始日（2025年12月1日以降 - APIデータ保持期間制限のため）
const TARGET_START_DATE = '251201';

const TIKTOK_API_BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';

// 期待される列名
const EXPECTED_COLUMNS = {
  registrationPath: ['登録経路', '流入経路', 'registration_path', 'path', 'ファネル登録経路'],
  date: ['登録日時', '登録日', 'date', 'created_at', 'timestamp', 'アクション実行日時', '実行日時'],
};

interface AdInitialCPA {
  adId: string;
  adName: string;
  accountName: string;
  lpCrName: string;   // LP1-CR00xxx など
  registrationPath: string;
  startDate: string;  // 出稿日（配信開始日）
  endDate: string;    // 初動終了日
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

/**
 * YYMMDD形式の文字列をDateに変換
 */
function parseYYMMDD(yymmdd: string): Date | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;

  const yy = parseInt(yymmdd.substring(0, 2), 10);
  const mm = parseInt(yymmdd.substring(2, 4), 10) - 1; // 0-indexed
  const dd = parseInt(yymmdd.substring(4, 6), 10);

  // 2000年代と仮定
  const year = 2000 + yy;

  const date = new Date(year, mm, dd);
  if (isNaN(date.getTime())) return null;

  return date;
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
 * Smart+広告のメトリクスを取得（期間指定）
 */
async function getSmartPlusMetrics(
  advertiserId: string,
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, number>> {
  const spendMap = new Map<string, number>();

  try {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/material_report/overview/`, {
        headers: { 'Access-Token': accessToken },
        params: {
          advertiser_id: advertiserId,
          dimensions: JSON.stringify(['smart_plus_ad_id', 'main_material_id']),
          metrics: JSON.stringify(['spend']),
          start_date: startDate,
          end_date: endDate,
          page: page,
          page_size: 100,
        },
      });

      const list = response.data.data?.list || [];
      if (list.length > 0) {
        for (const item of list) {
          const smartPlusAdId = item.dimensions?.smart_plus_ad_id;
          const spend = parseFloat(item.metrics?.spend || '0');

          // smart_plus_ad_id別に集計
          spendMap.set(smartPlusAdId, (spendMap.get(smartPlusAdId) || 0) + spend);
        }

        const totalPages = Math.ceil((response.data.data?.page_info?.total_number || 0) / 100);
        if (page >= totalPages) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }
  } catch (error: any) {
    console.error(`Smart+メトリクス取得エラー:`, error.response?.data || error.message);
  }

  return spendMap;
}

/**
 * 広告名から出稿日とLP名-CR番号を抽出
 * 形式: YYMMDD/制作者名/CR名/LP名-CR番号
 */
function parseAdName(adName: string): {
  launchDate: string;      // YYMMDD形式
  lpCrName: string;        // LP1-CR00xxx など
} | null {
  // 正規表現で YYMMDD/ で始まるパターンを検出
  const parts = adName.split('/');
  if (parts.length < 4) return null;

  const firstPart = parts[0];
  if (!/^\d{6}$/.test(firstPart)) return null;

  // 最後のパートからLP名-CR番号を抽出
  const lastPart = parts[parts.length - 1];
  const lpMatch = lastPart.match(/(LP\d+-CR\d+)/i);
  if (!lpMatch) return null;

  return {
    launchDate: firstPart,
    lpCrName: lpMatch[1].toUpperCase(),
  };
}

/**
 * 登録経路を生成（CR番号も含む）
 */
function generateRegistrationPath(lpCrName: string): string {
  return `TikTok広告-AI-${lpCrName}`;
}

/**
 * CSVファイルに出力
 */
function exportToCSV(data: AdInitialCPA[], outputPath: string): void {
  const headers = [
    '広告ID',
    '広告名',
    'アカウント名',
    'LP-CR',
    '登録経路',
    '出稿日',
    '初動終了日',
    '初動3日間費用',
    '初動3日間CV数',
    '初動3日間CPA',
  ];

  const rows = data.map(d => [
    d.adId,
    `"${d.adName.replace(/"/g, '""')}"`,
    d.accountName,
    d.lpCrName,
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
    console.log('=== AI導線 CR別初動3日間CPA算出 ===\n');
    console.log(`対象アカウント: ${AI_ADVERTISERS.map(a => a.name).join(', ')}`);
    console.log(`CVスプレッドシートID: ${CV_SPREADSHEET_ID}`);
    console.log(`初動期間: ${INITIAL_PERIOD_DAYS}日間`);
    console.log(`対象: 2025年12月以降出稿分（APIデータ保持期間制限のため）\n`);

    // アクセストークン取得
    const accessToken = getAccessToken();
    console.log('アクセストークン取得完了\n');

    const results: AdInitialCPA[] = [];
    let totalProcessed = 0;
    let totalSkippedFormat = 0;
    let totalSkippedDate = 0;

    // 各Advertiserを処理
    for (const advertiser of AI_ADVERTISERS) {
      console.log(`\n=== ${advertiser.name} (${advertiser.id}) ===`);

      // DBから広告一覧を取得
      const dbAdvertiser = await prisma.advertiser.findFirst({
        where: { tiktokAdvertiserId: advertiser.id },
        include: {
          campaigns: {
            include: {
              adGroups: {
                include: {
                  ads: {
                    select: {
                      tiktokId: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!dbAdvertiser) {
        console.log(`  Advertiser not found in DB: ${advertiser.id}`);
        continue;
      }

      // 広告を集約
      const ads: { tiktokId: string; name: string }[] = [];
      for (const campaign of dbAdvertiser.campaigns) {
        for (const adGroup of campaign.adGroups) {
          for (const ad of adGroup.ads) {
            ads.push({ tiktokId: ad.tiktokId, name: ad.name });
          }
        }
      }

      console.log(`  広告数: ${ads.length}`);

      // 2025年12月以降の広告をフィルタリング
      const targetAds: { tiktokId: string; name: string; launchDate: string; lpCrName: string }[] = [];

      for (const ad of ads) {
        const parsed = parseAdName(ad.name);
        if (!parsed) {
          totalSkippedFormat++;
          continue;
        }

        if (parsed.launchDate < TARGET_START_DATE) {
          totalSkippedDate++;
          continue;
        }

        targetAds.push({
          tiktokId: ad.tiktokId,
          name: ad.name,
          launchDate: parsed.launchDate,
          lpCrName: parsed.lpCrName,
        });
      }

      console.log(`  対象広告数（2025年12月以降）: ${targetAds.length}`);

      if (targetAds.length === 0) continue;

      // 広告をグループ化（同じ初動期間でまとめてAPI呼び出し）
      const adsByDateRange = new Map<string, typeof targetAds>();

      for (const ad of targetAds) {
        const launchDateObj = parseYYMMDD(ad.launchDate);
        if (!launchDateObj) continue;

        const startDate = formatDate(launchDateObj);
        const endDate = formatDate(addDays(launchDateObj, INITIAL_PERIOD_DAYS - 1));
        const key = `${startDate}_${endDate}`;

        if (!adsByDateRange.has(key)) {
          adsByDateRange.set(key, []);
        }
        adsByDateRange.get(key)!.push(ad);
      }

      // 日付範囲ごとにAPI呼び出し
      for (const [dateRange, adsInRange] of adsByDateRange) {
        const [startDate, endDate] = dateRange.split('_');

        // Smart+ APIから広告費を取得
        const spendMap = await getSmartPlusMetrics(
          advertiser.id,
          accessToken,
          startDate,
          endDate,
        );

        console.log(`  期間 ${startDate}〜${endDate}: ${spendMap.size}件のSmart+メトリクス取得`);

        // 各広告を処理
        for (const ad of adsInRange) {
          // Smart+ APIはsmart_plus_ad_idを返すが、DBにはtiktokIdが保存されている
          // 両者が一致するか確認し、一致しなければtiktokIdでマッピング
          const spend = spendMap.get(ad.tiktokId) || 0;
          const registrationPath = generateRegistrationPath(ad.lpCrName);

          // CV数をスプレッドシートから取得
          const launchDateObj = parseYYMMDD(ad.launchDate)!;
          const cvStartDate = launchDateObj;
          const cvEndDate = addDays(launchDateObj, INITIAL_PERIOD_DAYS - 1);
          cvEndDate.setHours(23, 59, 59, 999);

          const cvCount = await countCVFromSpreadsheet(
            registrationPath,
            cvStartDate,
            cvEndDate,
          );

          // CPA計算
          const cpa = cvCount > 0 ? spend / cvCount : 0;

          results.push({
            adId: ad.tiktokId,
            adName: ad.name,
            accountName: advertiser.name,
            lpCrName: ad.lpCrName,
            registrationPath,
            startDate,
            endDate,
            spend,
            cvCount,
            cpa,
          });

          totalProcessed++;

          if (spend > 0 || cvCount > 0) {
            console.log(`    [OK] ${ad.name.substring(0, 50)}...`);
            console.log(`         費用=¥${spend.toFixed(0)}, CV=${cvCount}, CPA=${cpa > 0 ? `¥${cpa.toFixed(0)}` : 'N/A'}`);
          }
        }

        // API呼び出し間隔
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`\n=== 処理結果 ===`);
    console.log(`処理件数: ${totalProcessed}`);
    console.log(`形式不正でスキップ: ${totalSkippedFormat}`);
    console.log(`日付外でスキップ: ${totalSkippedDate}`);

    // 出稿日でソート
    results.sort((a, b) => a.startDate.localeCompare(b.startDate));

    // CSV出力
    const outputDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const outputPath = path.join(outputDir, `AI導線_初動3日間CPA_${timestamp}.csv`);

    exportToCSV(results, outputPath);

    // サマリー出力
    console.log('\n=== サマリー ===');
    console.log(`総広告数: ${results.length}`);
    console.log(`総費用: ¥${results.reduce((sum, r) => sum + r.spend, 0).toLocaleString()}`);
    console.log(`総CV数: ${results.reduce((sum, r) => sum + r.cvCount, 0)}`);

    const totalSpend = results.reduce((sum, r) => sum + r.spend, 0);
    const totalCV = results.reduce((sum, r) => sum + r.cvCount, 0);

    if (totalCV > 0) {
      console.log(`全体平均CPA: ¥${(totalSpend / totalCV).toFixed(0)}`);
    }

    // CVが発生した広告の数
    const adsWithCV = results.filter(r => r.cvCount > 0);
    console.log(`CV発生広告数: ${adsWithCV.length} / ${results.length}`);

    if (adsWithCV.length > 0) {
      const avgCPA = adsWithCV.reduce((sum, r) => sum + r.cpa, 0) / adsWithCV.length;
      console.log(`CV発生広告の平均CPA: ¥${avgCPA.toFixed(0)}`);

      // CPA上位5件
      const topCPA = [...adsWithCV].sort((a, b) => a.cpa - b.cpa).slice(0, 5);
      console.log('\nCPA上位5件（良い順）:');
      topCPA.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.adName.substring(0, 40)}...`);
        console.log(`     CPA=¥${r.cpa.toFixed(0)}, CV=${r.cvCount}, 費用=¥${r.spend.toFixed(0)}`);
      });
    }

    // 費用がゼロの広告の数
    const adsWithNoSpend = results.filter(r => r.spend === 0);
    console.log(`\n費用ゼロの広告数: ${adsWithNoSpend.length}`);

  } catch (error) {
    console.error('エラーが発生しました:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
