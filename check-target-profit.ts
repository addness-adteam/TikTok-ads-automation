import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, 'apps/backend/.env') });
const { google } = require('googleapis');

const SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // AI: 3月のデータ範囲を確認
  const allA = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "'AI'!A440:A485" });
  console.log('=== AI A列 440-485 ===');
  (allA.data.values || []).forEach((r: any, i: number) => {
    const v = String(r[0] || '').trim();
    if (v) console.log(`  行${440+i}: "${v}"`);
  });

  // KPIセクション
  const kpi = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "'AI'!AV440:AX485" });
  console.log('\n=== AI KPI列(AV-AX) 440-485 ===');
  (kpi.data.values || []).forEach((r: any, i: number) => {
    const item = String(r[0] || '').trim();
    const allow = String(r[1] || '').trim();
    const target = String(r[2] || '').trim();
    if (item) console.log(`  行${440+i}: item="${item}" allow="${allow}" target="${target}"`);
  });
}
main();
