/**
 * 個別予約シート（AI）のヘッダーとサンプルデータを取得して構造を確認する
 */
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const SPREADSHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';
const SHEET_NAME = 'AI';

async function main() {
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
  if (!credJson) {
    console.error('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS env var not set');
    process.exit(1);
  }

  const credentials = JSON.parse(credJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // A列からBZ列まで広範囲取得（ヘッダー + 数行）
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A1:BZ5`,
  });

  const rows = response.data?.values || [];
  if (rows.length === 0) {
    console.log('No data found');
    return;
  }

  const headers = rows[0];
  console.log('=== ヘッダー一覧 ===');
  headers.forEach((header: string, index: number) => {
    const colLetter = indexToColumnLetter(index);
    console.log(`  ${colLetter} (index ${index}): ${header}`);
  });

  console.log(`\n合計カラム数: ${headers.length}`);

  // サンプルデータ（2-5行目）
  if (rows.length > 1) {
    console.log('\n=== サンプルデータ（先頭数行） ===');
    for (let i = 1; i < rows.length; i++) {
      console.log(`\n--- Row ${i + 1} ---`);
      rows[i].forEach((value: string, index: number) => {
        if (value && String(value).trim()) {
          const colLetter = indexToColumnLetter(index);
          const headerName = headers[index] || '(no header)';
          console.log(`  ${colLetter} [${headerName}]: ${String(value).substring(0, 100)}`);
        }
      });
    }
  }
}

function indexToColumnLetter(index: number): string {
  let result = '';
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

main().catch(console.error);
