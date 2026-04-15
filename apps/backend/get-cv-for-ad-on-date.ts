/**
 * 特定広告の特定日のCV数を取得
 * - スプレッドシート（個別予約）から取得
 * - DBのMetricテーブルと比較
 */

import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

// 設定
const RESERVATION_SPREADSHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';
const TARGET_DATE = '2026-04-09';
const TARGET_AD_NAME = '260404/横展開/CR178_横展開/LP1-CR01159';
const TARGET_ACCOUNT_ID = '7543540647266074641'; // AI_3
const AI_SHEET = { sheetName: 'AI', dateColumnIndex: 0, pathColumnIndex: 46 };

function getGoogleSheetsAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

function parseJSTDate(dateString: string): Date | null {
  try {
    if (!dateString) return null;
    const trimmed = dateString.trim();
    const slashMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (slashMatch) {
      const year = parseInt(slashMatch[1]);
      const month = parseInt(slashMatch[2]) - 1;
      const day = parseInt(slashMatch[3]);
      return new Date(Date.UTC(year, month, day, -9, 0, 0));
    }
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function extractLPCRFromAdName(adName: string): string | null {
  const parts = adName.split('/');
  if (parts.length < 4) return null;
  const lastPart = parts[parts.length - 1];
  const match = lastPart.match(/(LP\d+-CR\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

function extractLPCRFromPath(registrationPath: string): string | null {
  const match = registrationPath.match(/(LP\d+-CR\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

async function getReservationsFromSheet(): Promise<{ count: number; paths: string[] }> {
  const auth = getGoogleSheetsAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  console.log(`\n--- スプレッドシートから個別予約を取得 ---`);
  console.log(`対象日: ${TARGET_DATE}`);
  console.log(`対象広告: ${TARGET_AD_NAME}`);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: RESERVATION_SPREADSHEET_ID,
    range: `${AI_SHEET.sheetName}!A:AZ`,
  });

  const rows = response.data.values || [];
  if (!rows || rows.length === 0) {
    console.log('スプレッドシートが空です');
    return { count: 0, paths: [] };
  }

  const targetDate = new Date(`${TARGET_DATE}T00:00:00+09:00`);
  const nextDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);

  const targetLPCR = extractLPCRFromAdName(TARGET_AD_NAME);
  console.log(`抽出したLP-CR: ${targetLPCR}`);

  let cvCount = 0;
  const foundPaths: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateValue = row[AI_SHEET.dateColumnIndex];
    const pathValue = row[AI_SHEET.pathColumnIndex];

    if (!dateValue) continue;

    const rowDate = parseJSTDate(String(dateValue));
    if (!rowDate) continue;
    if (rowDate < targetDate || rowDate >= nextDate) continue;

    if (!pathValue) continue;

    const lines = String(pathValue).split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const pathLPCR = extractLPCRFromPath(trimmed);
      if (pathLPCR === targetLPCR) {
        cvCount++;
        foundPaths.push(trimmed);
      }
    }
  }

  console.log(`スプレッドシート取得結果: ${cvCount}件`);
  if (foundPaths.length > 0) {
    console.log(`  取得パス例: ${foundPaths.slice(0, 3).join(' | ')}`);
  }

  return { count: cvCount, paths: foundPaths };
}

async function getMetricsFromDB(): Promise<number> {
  console.log(`\n--- DBのMetricテーブルから取得 ---`);
  console.log(`対象日: ${TARGET_DATE}`);
  console.log(`対象広告: ${TARGET_AD_NAME}`);

  const advertiser = await prisma.advertiser.findUnique({
    where: { tiktokAdvertiserId: TARGET_ACCOUNT_ID },
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

  if (!advertiser) {
    console.log('アカウントがDBに登録されていません');
    return 0;
  }

  // 対象広告を探す
  let targetAdId: string | null = null;
  for (const campaign of advertiser.campaigns) {
    for (const adGroup of campaign.adGroups) {
      for (const ad of adGroup.ads) {
        if (ad.name === TARGET_AD_NAME) {
          targetAdId = ad.tiktokId;
          break;
        }
      }
      if (targetAdId) break;
    }
    if (targetAdId) break;
  }

  if (!targetAdId) {
    console.log(`広告がDBに登録されていません: ${TARGET_AD_NAME}`);
    return 0;
  }

  console.log(`広告ID: ${targetAdId}`);

  // Metricテーブルをクエリ（statDateはDateTime）
  const startOfDay = new Date(`${TARGET_DATE}T00:00:00Z`);
  const endOfDay = new Date(`${TARGET_DATE}T23:59:59Z`);

  const metrics = await prisma.metric.findMany({
    where: {
      adId: targetAdId,
      statDate: {
        gte: startOfDay,
        lt: new Date(endOfDay.getTime() + 1),
      },
    },
  });

  console.log(`DBの該当レコード数: ${metrics.length}件`);

  if (metrics.length > 0) {
    console.log('詳細:');
    let totalCV = 0;
    for (const metric of metrics) {
      console.log(`  - conversions: ${metric.conversions}, spend: ${metric.spend}, cpc: ${metric.cpc}, registrationPath: ${metric.registrationPath}`);
      totalCV += metric.conversions || 0;
    }
    return totalCV;
  }

  return 0;
}

async function main() {
  try {
    console.log('=====================================');
    console.log('特定広告の特定日のCV数取得');
    console.log('=====================================');

    // スプレッドシートから取得
    const sheetData = await getReservationsFromSheet();

    // DBから取得
    const dbCV = await getMetricsFromDB();

    // 結果表示
    console.log('\n=====================================');
    console.log('結果');
    console.log('=====================================');
    console.log(`スプレッドシート（個別予約）: ${sheetData.count}件`);
    console.log(`DB Metricテーブル: ${dbCV}件`);
    console.log(`差分: ${Math.abs(sheetData.count - dbCV)}件`);

  } catch (error) {
    console.error('エラー:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
