/**
 * スキルプラスの着座データ構造確認
 * npx tsx apps/backend/check-sp-sheets-list.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');
const SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // 全シート一覧を取得
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  console.log('=== シート一覧 ===');
  for (const s of meta.data.sheets) {
    console.log(`  ${s.properties.title} (rows: ${s.properties.gridProperties.rowCount})`);
  }

  // セミナー着座に関連しそうなシートのヘッダーと数行を確認
  const candidateSheets = meta.data.sheets
    .map((s: any) => s.properties.title)
    .filter((t: string) => t.includes('着座') || t.includes('セミナー') || t.includes('ウェビナー') || t.includes('参加'));

  for (const sheetName of candidateSheets) {
    console.log(`\n=== ${sheetName} ===`);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${sheetName}'!A1:AZ5`,
    });
    const rows = res.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      const parts: string[] = [];
      for (let j = 0; j < rows[i].length; j++) {
        if (rows[i][j] && String(rows[i][j]).trim()) {
          parts.push(`[${j}]${String(rows[i][j]).substring(0, 50)}`);
        }
      }
      console.log(`  row${i}: ${parts.join(' | ')}`);
    }
  }
}
main().catch(console.error);
