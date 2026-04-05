/**
 * 12月の広告別メトリクスをTikTok APIから直接取得してCSV出力
 * CPM, CTR, CVR, CPA, フロントCPO を含む
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';

// Google Sheets認証
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

interface AdMetrics {
  adId: string;
  adName: string;
  campaignId: string;
  campaignName: string;
  adgroupId: string;
  adgroupName: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpa: number;
}

interface SheetData {
  rows: any[][];
  pathColIndex: number;
  dateColIndex: number;
}

/**
 * 広告名をパース
 */
function parseAdName(adName: string): { lpName: string } | null {
  if (!adName) return null;
  const parts = adName.split('/');
  if (parts.length < 4) return null;
  return { lpName: parts[parts.length - 1] };
}

/**
 * 登録経路を生成
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
      console.log(`    列が見つかりません`);
      return null;
    }

    console.log(`    ${rows.length - 1}行のデータを読み込み`);
    return { rows, pathColIndex, dateColIndex };
  } catch (error) {
    console.log(`    エラー: ${error.message}`);
    return null;
  }
}

/**
 * 登録経路ごとのカウントを事前計算
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

    counts.set(pathValue, (counts.get(pathValue) || 0) + 1);
  }

  return counts;
}

/**
 * TikTok APIからレポートデータを取得（ページネーション対応）
 */
async function fetchAllAdReports(
  advertiserId: string,
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<AdMetrics[]> {
  const allAds: AdMetrics[] = [];
  let page = 1;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    console.log(`  ページ ${page} を取得中...`);

    const params = {
      advertiser_id: advertiserId,
      data_level: 'AUCTION_AD',
      report_type: 'BASIC',
      dimensions: JSON.stringify(['ad_id']),
      metrics: JSON.stringify([
        'ad_name',
        'campaign_id',
        'campaign_name',
        'adgroup_id',
        'adgroup_name',
        'impressions',
        'clicks',
        'spend',
        'conversion',
        'ctr',
        'cpc',
        'cpm',
        'cost_per_conversion',
      ]),
      start_date: startDate,
      end_date: endDate,
      page,
      page_size: pageSize,
    };

    try {
      const response = await axios.get(`${TIKTOK_API_BASE}/v1.3/report/integrated/get/`, {
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        params,
      });

      if (response.data?.code !== 0) {
        console.log(`  APIエラー: ${response.data?.message}`);
        break;
      }

      const data = response.data?.data;
      const rows = data?.list || [];

      for (const row of rows) {
        const dimensions = row.dimensions || {};
        const metrics = row.metrics || {};

        allAds.push({
          adId: dimensions.ad_id || '',
          adName: metrics.ad_name || '',
          campaignId: metrics.campaign_id || '',
          campaignName: metrics.campaign_name || '',
          adgroupId: metrics.adgroup_id || '',
          adgroupName: metrics.adgroup_name || '',
          impressions: parseInt(metrics.impressions || '0', 10),
          clicks: parseInt(metrics.clicks || '0', 10),
          spend: parseFloat(metrics.spend || '0'),
          conversions: parseInt(metrics.conversion || '0', 10),
          ctr: parseFloat(metrics.ctr || '0'),
          cpc: parseFloat(metrics.cpc || '0'),
          cpm: parseFloat(metrics.cpm || '0'),
          cpa: parseFloat(metrics.cost_per_conversion || '0'),
        });
      }

      const pageInfo = data?.page_info || {};
      const totalPage = pageInfo.total_page || 1;
      hasMore = page < totalPage;
      page++;
    } catch (error) {
      console.log(`  リクエストエラー: ${error.message}`);
      break;
    }
  }

  return allAds;
}

async function main() {
  console.log('==============================================');
  console.log('12月広告メトリクス - TikTok APIから直接取得');
  console.log('==============================================\n');

  const startDate = '2025-12-01';
  const endDate = '2025-12-31';
  const startDateTime = new Date('2025-12-01T00:00:00.000Z');
  const endDateTime = new Date('2025-12-31T23:59:59.999Z');

  const outputDir = path.join(__dirname, 'exports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 訴求情報を取得
  const appeals = await prisma.appeal.findMany();
  console.log(`訴求数: ${appeals.length}`);

  // スプレッドシートを事前に読み込み
  console.log('\nスプレッドシートを読み込み中...');

  const cvCounts = new Map<string, Map<string, number>>();
  const frontCounts = new Map<string, Map<string, number>>();

  for (const appeal of appeals) {
    console.log(`\n訴求: ${appeal.name}`);

    if (appeal.cvSpreadsheetUrl) {
      const spreadsheetId = extractSpreadsheetId(appeal.cvSpreadsheetUrl);
      if (spreadsheetId) {
        const sheetData = await loadSheet(spreadsheetId, 'TT_オプト');
        if (sheetData) {
          const counts = buildRegistrationPathCounts(sheetData, startDateTime, endDateTime);
          cvCounts.set(appeal.name, counts);
          console.log(`    CV登録経路数: ${counts.size}`);
        }
      }
    }

    if (appeal.frontSpreadsheetUrl) {
      const spreadsheetId = extractSpreadsheetId(appeal.frontSpreadsheetUrl);
      if (spreadsheetId) {
        const combinedCounts = new Map<string, number>();

        const sheetOTO = await loadSheet(spreadsheetId, 'TT【OTO】');
        if (sheetOTO) {
          const counts = buildRegistrationPathCounts(sheetOTO, startDateTime, endDateTime);
          for (const [p, c] of counts) {
            combinedCounts.set(p, (combinedCounts.get(p) || 0) + c);
          }
        }

        const sheet3day = await loadSheet(spreadsheetId, 'TT【3day】');
        if (sheet3day) {
          const counts = buildRegistrationPathCounts(sheet3day, startDateTime, endDateTime);
          for (const [p, c] of counts) {
            combinedCounts.set(p, (combinedCounts.get(p) || 0) + c);
          }
        }

        frontCounts.set(appeal.name, combinedCounts);
        console.log(`    フロント登録経路数: ${combinedCounts.size}`);
      }
    }
  }

  // OAuthトークンとAdvertiser情報を取得
  const oauthTokens = await prisma.oAuthToken.findMany({
    include: {
      advertiser: {
        include: { appeal: true },
      },
    },
  });

  console.log(`\nアクティブなAdvertiser数: ${oauthTokens.length}`);

  // 全広告データを収集
  const allAdData: {
    ad: AdMetrics;
    appealName: string;
    registrationPath: string;
    cvCount: number;
    frontSalesCount: number;
  }[] = [];

  for (const token of oauthTokens) {
    const advertiserId = token.advertiserId;
    const advertiserName = token.advertiser?.name || advertiserId;
    const appealName = token.advertiser?.appeal?.name || 'Unknown';

    console.log(`\n[${advertiserName}] TikTok APIからデータ取得中...`);

    const ads = await fetchAllAdReports(
      advertiserId,
      token.accessToken,
      startDate,
      endDate,
    );

    console.log(`  -> ${ads.length}件の広告を取得`);

    for (const ad of ads) {
      const parsedName = parseAdName(ad.adName);
      const lpName = parsedName?.lpName || '';
      const registrationPath = lpName && appealName !== 'Unknown'
        ? generateRegistrationPath(lpName, appealName)
        : '';

      const cvCount = registrationPath && cvCounts.has(appealName)
        ? (cvCounts.get(appealName)!.get(registrationPath) || 0)
        : 0;

      const frontSalesCount = registrationPath && frontCounts.has(appealName)
        ? (frontCounts.get(appealName)!.get(registrationPath) || 0)
        : 0;

      allAdData.push({
        ad,
        appealName,
        registrationPath,
        cvCount,
        frontSalesCount,
      });
    }
  }

  console.log(`\n合計: ${allAdData.length}件の広告データ`);

  // CSV作成
  const csvRows: string[] = [];
  csvRows.push('広告ID,広告名,広告セット名,キャンペーン名,訴求名,登録経路,インプレッション,クリック,消費額,TikTok CV,スプレッドシートCV数,フロント販売本数,CPM,CTR(%),CVR(%),CPA,フロントCPO');

  // 消費額順でソート
  allAdData.sort((a, b) => b.ad.spend - a.ad.spend);

  for (const data of allAdData) {
    const { ad, appealName, registrationPath, cvCount, frontSalesCount } = data;

    const cpm = ad.impressions > 0
      ? ((ad.spend / ad.impressions) * 1000).toFixed(2)
      : '0';

    const ctr = ad.impressions > 0
      ? ((ad.clicks / ad.impressions) * 100).toFixed(4)
      : '0';

    // CVRはスプレッドシートのCV数で計算
    const cvr = ad.clicks > 0
      ? ((cvCount / ad.clicks) * 100).toFixed(4)
      : '0';

    // CPAはスプレッドシートのCV数で計算
    const cpa = cvCount > 0
      ? (ad.spend / cvCount).toFixed(2)
      : '0';

    const frontCPO = frontSalesCount > 0
      ? (ad.spend / frontSalesCount).toFixed(2)
      : '0';

    csvRows.push(
      `"${ad.adId}","${ad.adName.replace(/"/g, '""')}","${ad.adgroupName.replace(/"/g, '""')}","${ad.campaignName.replace(/"/g, '""')}","${appealName}","${registrationPath}",${ad.impressions},${ad.clicks},${ad.spend.toFixed(2)},${ad.conversions},${cvCount},${frontSalesCount},${cpm},${ctr},${cvr},${cpa},${frontCPO}`
    );
  }

  const outputPath = path.join(outputDir, '12月_広告別メトリクス_API直接取得.csv');
  fs.writeFileSync(outputPath, '\uFEFF' + csvRows.join('\n'), 'utf8');
  console.log(`\n保存完了: ${outputPath}`);

  // 統計情報
  const totalSpend = allAdData.reduce((sum, d) => sum + d.ad.spend, 0);
  const totalImpressions = allAdData.reduce((sum, d) => sum + d.ad.impressions, 0);
  const totalClicks = allAdData.reduce((sum, d) => sum + d.ad.clicks, 0);
  const totalTikTokCV = allAdData.reduce((sum, d) => sum + d.ad.conversions, 0);
  const totalCV = allAdData.reduce((sum, d) => sum + d.cvCount, 0);
  const totalFront = allAdData.reduce((sum, d) => sum + d.frontSalesCount, 0);

  console.log('\n========================================');
  console.log('エクスポート完了！');
  console.log('========================================');
  console.log(`\n統計情報:`);
  console.log(`  広告数: ${allAdData.length}件`);
  console.log(`  総インプレッション: ${totalImpressions.toLocaleString()}`);
  console.log(`  総クリック: ${totalClicks.toLocaleString()}`);
  console.log(`  総消費額: ¥${totalSpend.toLocaleString()}`);
  console.log(`  TikTok CV数: ${totalTikTokCV.toLocaleString()}件`);
  console.log(`  スプレッドシートCV数: ${totalCV.toLocaleString()}件`);
  console.log(`  フロント販売: ${totalFront.toLocaleString()}件`);
  console.log(`  平均CPA: ¥${totalCV > 0 ? (totalSpend / totalCV).toFixed(2) : '0'}`);
  console.log(`  平均フロントCPO: ¥${totalFront > 0 ? (totalSpend / totalFront).toFixed(2) : '0'}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('エラー:', e);
  prisma.$disconnect();
  process.exit(1);
});
