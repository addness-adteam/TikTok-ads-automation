/**
 * 特定広告の詳細CV情報を取得
 * - スプレッドシート（個別予約）から2026-04-09のデータを全て取得
 * - DBの該当広告の全メトリクスを確認
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

async function main() {
  try {
    console.log('=====================================');
    console.log('特定広告の詳細CV情報');
    console.log('=====================================\n');

    const targetLPCR = extractLPCRFromAdName(TARGET_AD_NAME);
    console.log(`対象広告: ${TARGET_AD_NAME}`);
    console.log(`抽出LP-CR: ${targetLPCR}`);
    console.log(`対象日: ${TARGET_DATE}\n`);

    // === スプレッドシート ===
    console.log('--- スプレッドシート（個別予約）---');
    const auth = getGoogleSheetsAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: RESERVATION_SPREADSHEET_ID,
      range: `AI!A:AZ`,
    });

    const rows = response.data.values || [];
    const targetDate = new Date(`${TARGET_DATE}T00:00:00+09:00`);
    const nextDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);

    const targetDateRows: any[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const dateValue = row[0];
      if (!dateValue) continue;

      const rowDate = parseJSTDate(String(dateValue));
      if (!rowDate) continue;
      if (rowDate >= targetDate && rowDate < nextDate) {
        targetDateRows.push({
          rowIndex: i + 1,
          date: dateValue,
          registrationPath: row[46] || '(なし)',
        });
      }
    }

    console.log(`${TARGET_DATE}のレコード: ${targetDateRows.length}件`);
    if (targetDateRows.length > 0) {
      console.log('詳細:');
      let cvCount = 0;
      for (const r of targetDateRows.slice(0, 20)) {
        const paths = String(r.registrationPath).split('\n').map(p => p.trim()).filter(p => p);
        for (const p of paths) {
          const lpCr = extractLPCRFromPath(p);
          if (lpCr === targetLPCR) {
            cvCount++;
            console.log(`  行${r.rowIndex}: ${r.date} -> ${p}`);
          }
        }
      }
      console.log(`\n該当LP-CR（${targetLPCR}）の件数: ${cvCount}件`);
    }

    // === DB検索 ===
    console.log(`\n--- DB Advertiser ---`);
    const advertiser = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: TARGET_ACCOUNT_ID },
    });

    if (advertiser) {
      console.log(`アカウント: ${advertiser.name || advertiser.id}`);

      const ads = await prisma.ad.findMany({
        where: { name: TARGET_AD_NAME },
        include: { metrics: true },
      });

      console.log(`\nDB内の該当広告: ${ads.length}件`);
      for (const ad of ads) {
        console.log(`  ad_id: ${ad.tiktokId}`);
        console.log(`  name: ${ad.name}`);
        console.log(`  メトリクスレコード数: ${ad.metrics.length}件`);

        // 該当日付のメトリクスを確認
        const metricsOnDate = ad.metrics.filter(m => {
          const dateStr = m.statDate.toISOString().split('T')[0];
          return dateStr === TARGET_DATE;
        });

        console.log(`  ${TARGET_DATE}のメトリクス: ${metricsOnDate.length}件`);
        if (metricsOnDate.length > 0) {
          for (const m of metricsOnDate) {
            console.log(`    - conversions: ${m.conversions}, spend: ${m.spend}, registrationPath: ${m.registrationPath}`);
          }
        }
      }
    } else {
      console.log('アカウントが見つかりません');
    }

  } catch (error) {
    console.error('エラー:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
