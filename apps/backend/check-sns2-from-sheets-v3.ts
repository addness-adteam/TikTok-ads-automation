import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');

const RESERVATION_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // Get first 3 rows to understand structure
  console.log('=== SNSタブの構造（Row 0-2） ===\n');
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: RESERVATION_SHEET_ID,
    range: 'SNS!A1:AZ3'
  });
  const rows = r.data.values || [];
  for (let ri = 0; ri < rows.length; ri++) {
    console.log(`Row ${ri}:`);
    for (let ci = 0; ci < rows[ri].length; ci++) {
      if (rows[ri][ci]) console.log(`  Col${ci}: ${String(rows[ri][ci]).slice(0, 80)}`);
    }
  }

  // Check cols 44-52 for recent data
  console.log('\n=== Col 44-52 (直近データ) ===\n');
  const r2 = await sheets.spreadsheets.values.get({
    spreadsheetId: RESERVATION_SHEET_ID,
    range: 'SNS!A460:AZ475'
  });
  const rows2 = r2.data.values || [];
  for (const row of rows2) {
    const date = row[0] || '';
    const parts: string[] = [];
    for (let ci = 44; ci < Math.min(52, row.length); ci++) {
      if (row[ci]) parts.push(`c${ci}=${String(row[ci]).slice(0, 60)}`);
    }
    if (parts.length > 0) console.log(`${date}: ${parts.join(' | ')}`);
  }

  // Check what col 2,3,4,5,6,7 actually are
  console.log('\n=== データ行サンプル（3/15-3/20 全カラム表示）===\n');
  const r3 = await sheets.spreadsheets.values.get({
    spreadsheetId: RESERVATION_SHEET_ID,
    range: 'SNS!A464:AZ470'
  });
  const rows3 = r3.data.values || [];
  for (const row of rows3) {
    const date = row[0] || '';
    console.log(`\n[${date}]:`);
    for (let ci = 0; ci < row.length; ci++) {
      if (row[ci] && String(row[ci]).trim()) {
        console.log(`  Col${ci}: ${String(row[ci]).slice(0, 100)}`);
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
