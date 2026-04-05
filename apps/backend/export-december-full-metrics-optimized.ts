/**
 * 12月の広告別メトリクス完全版エクスポート（最適化版）
 * スプレッドシートを一度だけ読み込み、メモリ内でカウント
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

interface SheetData {
  rows: any[][];
  pathColIndex: number;
  dateColIndex: number;
}

/**
 * 広告名をパース
 */
function parseAdName(adName: string): ParsedAdName | null {
  if (!adName) return null;
  const parts = adName.split('/');
  if (parts.length < 4) return null;
  return {
    postDate: parts[0],
    creator: parts[1],
    crName: parts.slice(2, parts.length - 1).join('/'),
    lpName: parts[parts.length - 1],
  };
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
      console.log(`    列が見つかりません: path=${pathColIndex}, date=${dateColIndex}`);
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

    const currentCount = counts.get(pathValue) || 0;
    counts.set(pathValue, currentCount + 1);
  }

  return counts;
}

async function exportDecemberFullMetrics() {
  console.log('12月の広告別完全メトリクスをエクスポート開始（最適化版）...\n');

  const startDate = new Date('2025-12-01T00:00:00.000Z');
  const endDate = new Date('2025-12-31T23:59:59.999Z');

  const outputDir = path.join(__dirname, 'exports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 訴求情報を取得
  const appeals = await prisma.appeal.findMany();
  console.log(`訴求数: ${appeals.length}`);

  // スプレッドシートを事前に読み込み
  console.log('\nスプレッドシートを読み込み中...');

  const cvCounts = new Map<string, Map<string, number>>(); // appealName -> registrationPath -> count
  const frontCounts = new Map<string, Map<string, number>>();

  for (const appeal of appeals) {
    console.log(`\n訴求: ${appeal.name}`);

    // CVスプレッドシート
    if (appeal.cvSpreadsheetUrl) {
      const spreadsheetId = extractSpreadsheetId(appeal.cvSpreadsheetUrl);
      if (spreadsheetId) {
        const sheetData = await loadSheet(spreadsheetId, 'TT_オプト');
        if (sheetData) {
          const counts = buildRegistrationPathCounts(sheetData, startDate, endDate);
          cvCounts.set(appeal.name, counts);
          console.log(`    CV登録経路数: ${counts.size}`);
        }
      }
    }

    // フロントスプレッドシート
    if (appeal.frontSpreadsheetUrl) {
      const spreadsheetId = extractSpreadsheetId(appeal.frontSpreadsheetUrl);
      if (spreadsheetId) {
        const combinedCounts = new Map<string, number>();

        // TT【OTO】
        const sheetOTO = await loadSheet(spreadsheetId, 'TT【OTO】');
        if (sheetOTO) {
          const counts = buildRegistrationPathCounts(sheetOTO, startDate, endDate);
          for (const [path, count] of counts) {
            combinedCounts.set(path, (combinedCounts.get(path) || 0) + count);
          }
        }

        // TT【3day】
        const sheet3day = await loadSheet(spreadsheetId, 'TT【3day】');
        if (sheet3day) {
          const counts = buildRegistrationPathCounts(sheet3day, startDate, endDate);
          for (const [path, count] of counts) {
            combinedCounts.set(path, (combinedCounts.get(path) || 0) + count);
          }
        }

        frontCounts.set(appeal.name, combinedCounts);
        console.log(`    フロント登録経路数: ${combinedCounts.size}`);
      }
    }
  }

  // Advertiserと訴求の紐付けを取得
  const advertisers = await prisma.advertiser.findMany({
    include: { appeal: true },
  });

  const advertiserAppealMap = new Map<string, typeof appeals[0]>();
  for (const adv of advertisers) {
    if (adv.appeal) {
      advertiserAppealMap.set(adv.tiktokAdvertiserId, adv.appeal);
    }
  }

  console.log('\n広告別メトリクスを取得中...');

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

      // CVとフロント販売数を取得
      const cvCount = registrationPath && cvCounts.has(appealName)
        ? (cvCounts.get(appealName)!.get(registrationPath) || 0)
        : 0;

      const frontSalesCount = registrationPath && frontCounts.has(appealName)
        ? (frontCounts.get(appealName)!.get(registrationPath) || 0)
        : 0;

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
        cvCount: cvCount,
        frontSalesCount: frontSalesCount,
      });
    }

    const summary = adSummaryMap.get(adId)!;
    summary.totalImpressions += m.impressions;
    summary.totalClicks += m.clicks;
    summary.totalSpend += m.spend;
  }

  console.log(`  -> ${adSummaryMap.size}件の広告に集計`);

  // CSV作成
  const csvRows: string[] = [];
  csvRows.push('広告ID,広告名,広告セット名,キャンペーン名,訴求名,登録経路,インプレッション,クリック,消費額,CV数,フロント販売本数,CPM,CTR(%),CVR(%),CPA,フロントCPO');

  const sortedAds = Array.from(adSummaryMap.values()).sort((a, b) => b.totalSpend - a.totalSpend);

  for (const ad of sortedAds) {
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
  const adsWithFront = sortedAds.filter(ad => ad.frontSalesCount > 0).length;

  console.log('\n========================================');
  console.log('エクスポート完了！');
  console.log('========================================');
  console.log(`\n統計情報:`);
  console.log(`  広告数: ${sortedAds.length}件`);
  console.log(`  CVのある広告: ${adsWithCV}件`);
  console.log(`  フロント販売のある広告: ${adsWithFront}件`);
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
