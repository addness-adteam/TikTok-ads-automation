import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

const CV_SPREADSHEET_ID = '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk';
const SHEET_NAME = 'TT_オプト';

function getGoogleSheetsAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

async function main() {
  const auth = getGoogleSheetsAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: CV_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:Z`,
  });

  const rows = response.data.values || [];
  console.log('ヘッダー行:', rows[0]);

  // 登録経路の列を特定（E列 = 4）
  const pathCol = 4;
  const dateCol = 5;

  // 登録経路の一覧を収集
  const pathCounts = new Map<string, number>();
  const aiPaths: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const pathValue = row[pathCol];
    if (!pathValue) continue;

    pathCounts.set(pathValue, (pathCounts.get(pathValue) || 0) + 1);

    // AI関連のパスを収集
    if (pathValue.includes('AI') && !aiPaths.includes(pathValue)) {
      aiPaths.push(pathValue);
    }
  }

  console.log('\n=== AI関連の登録経路 ===');
  aiPaths.sort();
  for (const p of aiPaths) {
    console.log(`  ${p}: ${pathCounts.get(p)}件`);
  }

  // TikTok広告関連のパスも確認
  console.log('\n=== TikTok広告関連の登録経路 ===');
  const tiktokPaths = [...pathCounts.entries()]
    .filter(([p]) => p.includes('TikTok'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  for (const [p, count] of tiktokPaths) {
    console.log(`  ${p}: ${count}件`);
  }

  // 2025年12月以降のAI関連CVを確認
  console.log('\n=== 2025年12月以降のAI関連CV ===');
  let dec2025Count = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const pathValue = row[pathCol];
    const dateValue = row[dateCol];

    if (!pathValue || !dateValue) continue;
    if (!pathValue.includes('AI')) continue;

    const date = new Date(dateValue);
    if (date >= new Date('2025-12-01')) {
      dec2025Count++;
      if (dec2025Count <= 10) {
        console.log(`  ${dateValue}: ${pathValue}`);
      }
    }
  }
  console.log(`  合計: ${dec2025Count}件`);
}

main().catch(console.error);
