import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, 'apps/backend/.env') });
const { google } = require('googleapis');

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

  // SP recent rows
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `スキルプラス（オートウェビナー用）!A200:AZ210` });
  const rows = res.data.values || [];
  console.log('=== SP Recent rows ===');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    console.log(`Row ${200+i}: date=${row[0]}, opt=${row[7]}, indRes=${row[23]}, cost=${row[32]}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
