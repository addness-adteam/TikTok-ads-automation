/**
 * 登録経路別の詳細実績を確認
 * - どの登録経路（CR）にCV/フロント販売が集中しているか
 * - 個別予約のデータ確認
 */
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheetsApi = google.sheets({ version: 'v4', auth });

const INDIVIDUAL_RESERVATION_SPREADSHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

function extractSpreadsheetId(url: string): string {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Invalid URL: ${url}`);
  return match[1];
}

function parseDate(dateString: string): Date | null {
  if (!dateString) return null;
  const match = dateString.trim().match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!match) return null;
  return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
}

async function getSheetData(spreadsheetId: string, sheetName: string, range = 'A:AZ'): Promise<any[][]> {
  try {
    const res = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!${range}`,
    });
    return res.data.values || [];
  } catch (e: any) {
    console.log(`  ⚠ シート「${sheetName}」エラー: ${e.message?.substring(0, 80)}`);
    return [];
  }
}

async function main() {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = new Date(jstNow.getFullYear(), jstNow.getMonth(), jstNow.getDate());
  const days7ago = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const days30ago = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  const appeals = await prisma.appeal.findMany({ include: { advertisers: true } });

  // ===== 1. CVシートの登録経路別集計 =====
  console.log('=== 1. CVシート（TT_オプト）登録経路別 CV数 ===\n');

  for (const appeal of appeals) {
    if (!appeal.cvSpreadsheetUrl) continue;
    const spreadsheetId = extractSpreadsheetId(appeal.cvSpreadsheetUrl);
    const rows = await getSheetData(spreadsheetId, 'TT_オプト', 'A:Z');
    if (rows.length === 0) continue;

    const header = rows[0];
    let pathCol = -1, dateCol = -1;
    for (let i = 0; i < header.length; i++) {
      const h = String(header[i] || '').trim();
      if (['登録経路', '流入経路', 'ファネル登録経路'].includes(h)) pathCol = i;
      if (['登録日時', '登録日', 'アクション実行日時', '実行日時'].includes(h)) dateCol = i;
    }

    console.log(`📊 ${appeal.name}: pathCol=${pathCol}, dateCol=${dateCol}`);

    // TikTok広告の登録経路をカウント
    const pathCounts7: Record<string, number> = {};
    const pathCounts30: Record<string, number> = {};

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const pathValue = String(row[pathCol] || '');
      const dateValue = String(row[dateCol] || '');
      if (!pathValue.startsWith('TikTok広告')) continue;
      const rowDate = parseDate(dateValue);
      if (!rowDate) continue;

      if (rowDate >= days30ago && rowDate <= today) {
        pathCounts30[pathValue] = (pathCounts30[pathValue] || 0) + 1;
      }
      if (rowDate >= days7ago && rowDate <= today) {
        pathCounts7[pathValue] = (pathCounts7[pathValue] || 0) + 1;
      }
    }

    // CV数降順でソート
    const sorted30 = Object.entries(pathCounts30).sort((a, b) => b[1] - a[1]);
    console.log(`  30日間 TikTok広告CV（上位20）:`);
    for (const [path, count] of sorted30.slice(0, 20)) {
      const count7 = pathCounts7[path] || 0;
      console.log(`    ${String(count).padStart(4)}件(7日:${String(count7).padStart(3)}) | ${path}`);
    }
    console.log(`  合計: 30日=${Object.values(pathCounts30).reduce((s, v) => s + v, 0)}件, 7日=${Object.values(pathCounts7).reduce((s, v) => s + v, 0)}件\n`);
  }

  // ===== 2. フロント販売の登録経路別集計 =====
  console.log('\n=== 2. フロント販売 登録経路別 ===\n');

  for (const appeal of appeals) {
    if (!appeal.frontSpreadsheetUrl) continue;
    const spreadsheetId = extractSpreadsheetId(appeal.frontSpreadsheetUrl);

    for (const sheetName of ['TT【OTO】', 'TT【3day】']) {
      const rows = await getSheetData(spreadsheetId, sheetName, 'A:Z');
      if (rows.length === 0) continue;

      const header = rows[0];
      let pathCol = -1, dateCol = -1;
      for (let i = 0; i < header.length; i++) {
        const h = String(header[i] || '').trim();
        if (['登録経路', '流入経路', 'ファネル登録経路'].includes(h)) pathCol = i;
        if (['登録日時', '登録日', 'アクション実行日時', '実行日時'].includes(h)) dateCol = i;
      }

      const pathCounts30: Record<string, number> = {};
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const pathValue = String(row[pathCol] || '');
        const dateValue = String(row[dateCol] || '');
        if (!pathValue.startsWith('TikTok広告')) continue;
        const rowDate = parseDate(dateValue);
        if (!rowDate || rowDate < days30ago || rowDate > today) continue;
        pathCounts30[pathValue] = (pathCounts30[pathValue] || 0) + 1;
      }

      if (Object.keys(pathCounts30).length > 0) {
        console.log(`📊 ${appeal.name} - ${sheetName}:`);
        const sorted = Object.entries(pathCounts30).sort((a, b) => b[1] - a[1]);
        for (const [path, count] of sorted.slice(0, 15)) {
          console.log(`    ${String(count).padStart(4)}件 | ${path}`);
        }
        console.log(`  合計: ${Object.values(pathCounts30).reduce((s, v) => s + v, 0)}件\n`);
      }
    }
  }

  // ===== 3. 個別予約の確認 =====
  console.log('\n=== 3. 個別予約シート サンプルデータ確認 ===\n');

  for (const channelType of ['AI', 'SNS', 'SEMINAR'] as const) {
    const config: Record<string, { sheetName: string; dateCol: number; pathCol: number }> = {
      SEMINAR: { sheetName: 'スキルプラス（オートウェビナー用）', dateCol: 0, pathCol: 34 },
      AI: { sheetName: 'AI', dateCol: 0, pathCol: 46 },
      SNS: { sheetName: 'SNS', dateCol: 0, pathCol: 46 },
    };
    const c = config[channelType];
    const rows = await getSheetData(INDIVIDUAL_RESERVATION_SPREADSHEET_ID, c.sheetName, 'A:AZ');

    console.log(`📊 ${channelType} (${c.sheetName}): ${rows.length}行`);
    if (rows.length > 0) {
      // ヘッダーのpathCol付近を表示
      const header = rows[0];
      console.log(`  pathCol(${c.pathCol})のヘッダー: "${header[c.pathCol] || '(empty)'}"`);
      console.log(`  dateCol(${c.dateCol})のヘッダー: "${header[c.dateCol] || '(empty)'}"`);

      // TikTok広告の個別予約を集計
      const pathCounts30: Record<string, number> = {};
      let totalTikTok = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const dateValue = String(row[c.dateCol] || '');
        const pathValue = String(row[c.pathCol] || '');
        if (!dateValue) continue;
        const rowDate = parseDate(dateValue);
        if (!rowDate || rowDate < days30ago || rowDate > today) continue;

        const lines = pathValue.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.includes('TikTok')) {
            totalTikTok++;
            pathCounts30[trimmed] = (pathCounts30[trimmed] || 0) + 1;
          }
        }
      }

      if (totalTikTok > 0) {
        const sorted = Object.entries(pathCounts30).sort((a, b) => b[1] - a[1]);
        for (const [path, count] of sorted.slice(0, 10)) {
          console.log(`    ${String(count).padStart(4)}件 | ${path}`);
        }
        console.log(`  TikTok合計: ${totalTikTok}件`);
      } else {
        console.log(`  TikTok広告の個別予約: 0件`);
        // サンプル表示（pathColの値を5行分）
        for (let i = 1; i <= Math.min(5, rows.length - 1); i++) {
          const pathVal = String(rows[i][c.pathCol] || '').substring(0, 60);
          console.log(`  sample[${i}]: "${pathVal}"`);
        }
      }
    }
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
