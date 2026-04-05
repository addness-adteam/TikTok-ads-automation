/**
 * 個別予約スプレッドシートの全タブ名を取得
 * また、CVシートとフロント販売シートの情報もAPIから取得する
 */
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const INDIVIDUAL_RESERVATION_SPREADSHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

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

  // 個別予約スプレッドシートのタブ一覧
  console.log('=== 個別予約スプレッドシートのタブ一覧 ===');
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: INDIVIDUAL_RESERVATION_SPREADSHEET_ID,
  });
  const sheetList = meta.data.sheets || [];
  for (const s of sheetList) {
    console.log(`  - ${s.properties?.title} (rows: ${s.properties?.gridProperties?.rowCount}, cols: ${s.properties?.gridProperties?.columnCount})`);
  }

  // AIシートのAU列（index 46）付近を確認
  console.log('\n=== AIシート AU-AX列（個別予約関連） ===');
  try {
    const auData = await sheets.spreadsheets.values.get({
      spreadsheetId: INDIVIDUAL_RESERVATION_SPREADSHEET_ID,
      range: "'AI'!A1:AX10",
    });
    const rows = auData.data?.values || [];
    if (rows.length > 0) {
      // Row 2 (index 1) がヘッダー行の可能性
      for (let r = 0; r < Math.min(rows.length, 6); r++) {
        const row = rows[r];
        console.log(`\nRow ${r + 1}:`);
        for (let c = 44; c < Math.min(row.length, 50); c++) {
          const colLetter = indexToColumnLetter(c);
          if (row[c]) console.log(`  ${colLetter} (${c}): ${String(row[c]).substring(0, 120)}`);
        }
      }
    }
  } catch (e: any) {
    console.log('Error fetching AU data:', e.message);
  }

  // 本番DBからAppealのCVシートURLを取得することはできないので、
  // APIを使って確認する
  console.log('\n=== API経由でAppeal情報を取得 ===');
  try {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch('https://tik-tok-ads-automation-backend.vercel.app/api/budget-optimization-v2/appeals');
    if (res.ok) {
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(`API returned ${res.status}`);
    }
  } catch (e: any) {
    console.log('API fetch error:', e.message);
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
