import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, 'apps/backend/.env') });
const { google } = require('googleapis');

const SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  for (const sheetName of ['AI', 'SNS', 'スキルプラス（オートウェビナー用）']) {
    console.log(`\n=== ${sheetName} ===`);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A1:AZ5` });
    const rows = res.data.values || [];

    // ヘッダー行（1行目と2行目）
    for (let r = 0; r < Math.min(rows.length, 3); r++) {
      const row = rows[r];
      console.log(`行${r+1}:`);
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').trim();
        if (val) {
          const colLetter = c < 26 ? String.fromCharCode(65+c) : String.fromCharCode(64+Math.floor(c/26)) + String.fromCharCode(65+c%26);
          console.log(`  ${colLetter}(${c}): "${val}"`);
        }
      }
    }

    // 直近の月集計行を探す（「2026/3」「3月」「2026年3月」等を含む行）
    const allRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A1:AZ500` });
    const allRows = allRes.data.values || [];
    console.log(`\n全${allRows.length}行`);

    // 直近50行で月集計っぽい行を探す
    const startIdx = Math.max(0, allRows.length - 50);
    for (let i = startIdx; i < allRows.length; i++) {
      const a = String(allRows[i][0] || '').trim();
      if (a.match(/^\d{4}\/\d{1,2}$/) || a.includes('月') || a.includes('合計') || a.match(/^\d{4}年/)) {
        // 月集計行っぽい
        const row = allRows[i];
        console.log(`\n行${i+1} (月集計候補): A="${a}"`);
        for (let c = 0; c < Math.min(row.length, 50); c++) {
          const val = String(row[c] || '').trim();
          if (val) {
            const colLetter = c < 26 ? String.fromCharCode(65+c) : String.fromCharCode(64+Math.floor(c/26)) + String.fromCharCode(65+c%26);
            console.log(`  ${colLetter}(${c}): "${val}"`);
          }
        }
      }
    }
  }
}
main().catch(err => { console.error('Error:', err); process.exit(1); });
