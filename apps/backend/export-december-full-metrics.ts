/**
 * 12月の広告別メトリクス完全版エクスポート
 * CPM, CTR, CVR, CPA, フロントCPO を含む
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

interface ParsedAdName {
  postDate: string;
  creator: string;
  crName: string;
  lpName: string;
}

interface AdSummary {
  adId: string;
  adTiktokId: string;
  adName: string;
  adgroupName: string;
  campaignName: string;
  appealName: string;
  registrationPath: string;
  totalImpressions: number;
  totalClicks: number;
  totalSpend: number;
  cvCount: number;
  frontSalesCount: number;
}

/**
 * 広告名をパース
 * 形式: 出稿日/制作者名/CR名/LP名-番号
 */
function parseAdName(adName: string): ParsedAdName | null {
  if (!adName) return null;

  const parts = adName.split('/');
  if (parts.length < 4) return null;

  const postDate = parts[0];
  const creator = parts[1];
  // 最後のパートがLP名、それ以外がCR名
  const lpName = parts[parts.length - 1];
  const crName = parts.slice(2, parts.length - 1).join('/');

  return { postDate, creator, crName, lpName };
}

/**
 * 登録経路を生成
 * 形式: TikTok広告-訴求-LP名
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
 * スプレッドシートから登録経路の件数をカウント
 */
async function countRegistrationPath(
  spreadsheetId: string,
  sheetName: string,
  registrationPath: string,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    const rows = response.data?.values || [];
    if (rows.length === 0) return 0;

    // ヘッダー行から列位置を検出
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
      console.log(`  列が見つかりません: path=${pathColIndex}, date=${dateColIndex} in ${sheetName}`);
      return 0;
    }

    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const pathValue = row[pathColIndex];
      const dateValue = row[dateColIndex];

      if (!pathValue || !dateValue) continue;
      if (pathValue !== registrationPath) continue;

      const rowDate = new Date(dateValue);
      if (isNaN(rowDate.getTime())) continue;

      if (rowDate >= startDate && rowDate <= endDate) {
        count++;
      }
    }

    return count;
  } catch (error) {
    console.log(`  スプレッドシート取得エラー (${sheetName}): ${error.message}`);
    return 0;
  }
}

/**
 * CV数を取得
 */
async function getCVCount(
  cvSpreadsheetUrl: string,
  registrationPath: string,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  const spreadsheetId = extractSpreadsheetId(cvSpreadsheetUrl);
  if (!spreadsheetId) return 0;

  return countRegistrationPath(spreadsheetId, 'TT_オプト', registrationPath, startDate, endDate);
}

/**
 * フロント販売本数を取得
 */
async function getFrontSalesCount(
  frontSpreadsheetUrl: string,
  registrationPath: string,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  const spreadsheetId = extractSpreadsheetId(frontSpreadsheetUrl);
  if (!spreadsheetId) return 0;

  const countOTO = await countRegistrationPath(spreadsheetId, 'TT【OTO】', registrationPath, startDate, endDate);
  const count3day = await countRegistrationPath(spreadsheetId, 'TT【3day】', registrationPath, startDate, endDate);

  return countOTO + count3day;
}

async function exportDecemberFullMetrics() {
  console.log('12月の広告別完全メトリクスをエクスポート開始...\n');

  // 12月の日付範囲
  const startDate = new Date('2025-12-01T00:00:00.000Z');
  const endDate = new Date('2025-12-31T23:59:59.999Z');

  // 出力ディレクトリ
  const outputDir = path.join(__dirname, 'exports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 訴求情報を取得
  const appeals = await prisma.appeal.findMany();
  console.log(`訴求数: ${appeals.length}`);

  // Advertiserと訴求の紐付けを取得
  const advertisers = await prisma.advertiser.findMany({
    include: { appeal: true },
  });

  // AdvertiserIdからAppeal情報へのマップ
  const advertiserAppealMap = new Map<string, typeof appeals[0]>();
  for (const adv of advertisers) {
    if (adv.appeal) {
      advertiserAppealMap.set(adv.tiktokAdvertiserId, adv.appeal);
    }
  }

  console.log('\n広告別メトリクスを取得中...');

  // 広告別のメトリクスを取得
  const adMetrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      statDate: {
        gte: startDate,
        lte: endDate,
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

  // 広告ごとに集計
  const adSummaryMap = new Map<string, AdSummary>();

  for (const m of adMetrics) {
    const adId = m.adId || 'unknown';
    const advertiserId = m.ad?.adGroup?.campaign?.advertiser?.tiktokAdvertiserId;
    const appeal = advertiserId ? advertiserAppealMap.get(advertiserId) : null;

    if (!adSummaryMap.has(adId)) {
      const adName = m.ad?.name || 'Unknown';
      const parsedName = parseAdName(adName);
      const lpName = parsedName?.lpName || '';
      const appealName = appeal?.name || 'Unknown';
      const registrationPath = lpName && appealName !== 'Unknown'
        ? generateRegistrationPath(lpName, appealName)
        : '';

      adSummaryMap.set(adId, {
        adId: adId,
        adTiktokId: m.ad?.tiktokId || adId,
        adName: adName,
        adgroupName: m.ad?.adGroup?.name || 'Unknown',
        campaignName: m.ad?.adGroup?.campaign?.name || 'Unknown',
        appealName: appealName,
        registrationPath: registrationPath,
        totalImpressions: 0,
        totalClicks: 0,
        totalSpend: 0,
        cvCount: 0,
        frontSalesCount: 0,
      });
    }

    const summary = adSummaryMap.get(adId)!;
    summary.totalImpressions += m.impressions;
    summary.totalClicks += m.clicks;
    summary.totalSpend += m.spend;
  }

  console.log(`  -> ${adSummaryMap.size}件の広告に集計`);

  // スプレッドシートからCV数とフロント販売本数を取得
  console.log('\nスプレッドシートからCV数・フロント販売本数を取得中...');

  const sortedAds = Array.from(adSummaryMap.values()).sort((a, b) => b.totalSpend - a.totalSpend);
  let processedCount = 0;

  for (const ad of sortedAds) {
    processedCount++;
    if (processedCount % 50 === 0) {
      console.log(`  処理中: ${processedCount}/${sortedAds.length}`);
    }

    if (!ad.registrationPath) continue;

    const appeal = appeals.find(a => a.name === ad.appealName);
    if (!appeal || !appeal.cvSpreadsheetUrl || !appeal.frontSpreadsheetUrl) continue;

    try {
      ad.cvCount = await getCVCount(
        appeal.cvSpreadsheetUrl,
        ad.registrationPath,
        startDate,
        endDate,
      );

      ad.frontSalesCount = await getFrontSalesCount(
        appeal.frontSpreadsheetUrl,
        ad.registrationPath,
        startDate,
        endDate,
      );
    } catch (error) {
      console.log(`  エラー (${ad.adName}): ${error.message}`);
    }
  }

  console.log(`  -> ${processedCount}件の広告を処理完了`);

  // CSV作成
  const csvRows: string[] = [];
  csvRows.push('広告ID,広告名,広告セット名,キャンペーン名,訴求名,登録経路,インプレッション,クリック,消費額,CV数,フロント販売本数,CPM,CTR(%),CVR(%),CPA,フロントCPO');

  for (const ad of sortedAds) {
    // メトリクス計算
    const cpm = ad.totalImpressions > 0
      ? ((ad.totalSpend / ad.totalImpressions) * 1000).toFixed(2)
      : '0';

    const ctr = ad.totalImpressions > 0
      ? ((ad.totalClicks / ad.totalImpressions) * 100).toFixed(4)
      : '0';

    const cvr = ad.totalClicks > 0
      ? ((ad.cvCount / ad.totalClicks) * 100).toFixed(4)
      : '0';

    const cpa = ad.cvCount > 0
      ? (ad.totalSpend / ad.cvCount).toFixed(2)
      : '0';

    const frontCPO = ad.frontSalesCount > 0
      ? (ad.totalSpend / ad.frontSalesCount).toFixed(2)
      : '0';

    csvRows.push(
      `"${ad.adTiktokId}","${ad.adName.replace(/"/g, '""')}","${ad.adgroupName.replace(/"/g, '""')}","${ad.campaignName.replace(/"/g, '""')}","${ad.appealName}","${ad.registrationPath}",${ad.totalImpressions},${ad.totalClicks},${ad.totalSpend.toFixed(2)},${ad.cvCount},${ad.frontSalesCount},${cpm},${ctr},${cvr},${cpa},${frontCPO}`
    );
  }

  const outputPath = path.join(outputDir, '12月_広告別完全メトリクス_CPM_CTR_CVR_CPA_CPO.csv');
  fs.writeFileSync(outputPath, '\uFEFF' + csvRows.join('\n'), 'utf8');
  console.log(`\n保存完了: ${outputPath}`);

  // 統計情報
  const totalSpend = sortedAds.reduce((sum, ad) => sum + ad.totalSpend, 0);
  const totalCV = sortedAds.reduce((sum, ad) => sum + ad.cvCount, 0);
  const totalFront = sortedAds.reduce((sum, ad) => sum + ad.frontSalesCount, 0);
  const adsWithCV = sortedAds.filter(ad => ad.cvCount > 0).length;

  console.log('\n========================================');
  console.log('エクスポート完了！');
  console.log('========================================');
  console.log(`\n統計情報:`);
  console.log(`  広告数: ${sortedAds.length}件`);
  console.log(`  CVのある広告: ${adsWithCV}件`);
  console.log(`  総消費額: ¥${totalSpend.toLocaleString()}`);
  console.log(`  総CV数: ${totalCV}件`);
  console.log(`  総フロント販売: ${totalFront}件`);
  console.log(`  平均CPA: ¥${totalCV > 0 ? (totalSpend / totalCV).toFixed(2) : '0'}`);
  console.log(`  平均フロントCPO: ¥${totalFront > 0 ? (totalSpend / totalFront).toFixed(2) : '0'}`);

  await prisma.$disconnect();
}

exportDecemberFullMetrics().catch((e) => {
  console.error('エラーが発生しました:', e);
  prisma.$disconnect();
  process.exit(1);
});
