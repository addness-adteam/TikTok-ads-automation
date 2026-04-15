/**
 * スプシの個別予約列の登録経路を確認（直近7日分）
 * npx tsx apps/backend/check-sheet-paths.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');
const SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

const CONFIGS: Record<string, { sheetName: string; dateCol: number; pathCol: number }> = {
  'AI': { sheetName: 'AI', dateCol: 0, pathCol: 46 },
  'SNS': { sheetName: 'SNS', dateCol: 0, pathCol: 46 },
  'スキルプラス': { sheetName: 'スキルプラス（オートウェビナー用）', dateCol: 0, pathCol: 34 },
};

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const endDate = new Date(`${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(jstNow.getUTCDate()).padStart(2, '0')}T23:59:59+09:00`);
  const startDate = new Date(endDate.getTime() - 7 * 86400000);

  for (const [appeal, config] of Object.entries(CONFIGS)) {
    console.log(`\n=== ${appeal}シート ===`);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${config.sheetName}!A:AZ`,
    });
    const rows: any[][] = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const dateStr = String(row[config.dateCol] || '').trim();
      const pathValue = row[config.pathCol];
      if (!dateStr || !pathValue) continue;

      const m = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (!m) continue;
      const rowDate = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), -9, 0, 0));
      if (rowDate < startDate || rowDate > endDate) continue;

      const lines = String(pathValue).split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          console.log(`  ${dateStr} | ${trimmed}`);
        }
      }
    }
  }
}
main().catch(console.error);
