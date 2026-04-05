import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, 'apps/backend/.env') });
const { google } = require('googleapis');

const SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  for (const config of [
    { name: 'AI', sheetName: 'AI', itemCol: 47, allowCol: 48, targetCol: 49 },
    { name: 'SNS', sheetName: 'SNS', itemCol: 47, allowCol: 48, targetCol: 49 },
    { name: 'SP', sheetName: 'スキルプラス（オートウェビナー用）', itemCol: 36, allowCol: 37, targetCol: 38 },
  ]) {
    console.log(`\n=== ${config.name} KPIセクション ===`);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${config.sheetName}'!A:AZ`,
    });
    const rows = res.data.values || [];

    // KPI項目がある行を全て表示
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const item = String(row[config.itemCol] || '').trim();
      const allow = String(row[config.allowCol] || '').trim();
      const target = String(row[config.targetCol] || '').trim();

      if (item) {
        console.log(`  行${i+1}: item="${item}" | allow="${allow}" | target="${target}"`);

        // 特に目標粗利額の周辺を詳しく
        if (item.includes('粗利') || item.includes('目標') || item.includes('利益')) {
          console.log(`    ↑↑↑ 目標粗利関連！ rawAllow=[${row[config.allowCol]}] rawTarget=[${row[config.targetCol]}]`);
        }
      }
    }
  }
}
main().catch(err => { console.error('Error:', err); process.exit(1); });
