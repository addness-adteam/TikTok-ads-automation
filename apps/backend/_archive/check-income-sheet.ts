/**
 * 年収データスプレッドシートの構造を確認するスクリプト
 */
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

const SPREADSHEET_ID = '14Fy7JBSGbW65xLSqhPnSw5V6dranfH1HXPV1l6j73Uk';

async function main() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // シート一覧を取得
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  console.log('=== 年収データ スプレッドシート ===');
  console.log(`タイトル: ${spreadsheet.data.properties?.title}\n`);

  console.log('=== シート一覧 ===');
  for (const sheet of spreadsheet.data.sheets || []) {
    console.log(`  - ${sheet.properties?.title} (${sheet.properties?.gridProperties?.rowCount} rows)`);
  }

  // 各シートのヘッダーとサンプルデータを取得
  for (const sheet of spreadsheet.data.sheets || []) {
    const sheetName = sheet.properties?.title;
    if (!sheetName) continue;

    console.log(`\n=== シート: ${sheetName} ===`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z10`,
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('  (データなし)');
      continue;
    }

    // ヘッダー
    console.log('ヘッダー:');
    rows[0].forEach((h: string, i: number) => {
      const colLetter = String.fromCharCode(65 + i);
      console.log(`  ${colLetter}列 (${i}): ${h}`);
    });

    // サンプルデータ（最大5行）
    console.log('\nサンプルデータ:');
    for (let i = 1; i < Math.min(rows.length, 6); i++) {
      console.log(`  行${i + 1}: ${JSON.stringify(rows[i])}`);
    }

    // 行数確認
    const countResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:A`,
    });
    const totalRows = (countResponse.data.values || []).length;
    console.log(`\n  総行数: ${totalRows}`);
  }
}

main().catch(console.error);
