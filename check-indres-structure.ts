import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, 'apps/backend/.env') });
const { google } = require('googleapis');

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

  for (const tab of ['AI', 'SNS', 'スキルプラス（オートウェビナー用）']) {
    console.log(`\n=== ${tab} ===`);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A1:BZ5` });
    const rows = res.data.values || [];
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      console.log(`Row ${i}: ${rows[i].map((v: any, j: number) => `[${j}]${String(v || '').substring(0, 30)}`).join(' | ')}`);
    }
    // Also check a recent data row
    const res2 = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A470:BZ475` });
    const rows2 = res2.data.values || [];
    console.log(`\nRecent rows (470-475):`);
    for (let i = 0; i < rows2.length; i++) {
      console.log(`Row ${470+i}: ${rows2[i].map((v: any, j: number) => `[${j}]${String(v || '').substring(0, 40)}`).join(' | ')}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
