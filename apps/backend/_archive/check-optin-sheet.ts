import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
const { google } = require('googleapis');

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // スキルプラスのオプトシート
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk',
    range: 'TT_オプト!A1:Z5',
  });
  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    const parts: string[] = [];
    for (let j = 0; j < rows[i].length; j++) {
      if (rows[i][j] && String(rows[i][j]).trim()) {
        parts.push(`[${j}]${String(rows[i][j]).substring(0, 80)}`);
      }
    }
    console.log(`row${i}: ${parts.join(' | ')}`);
  }

  // 直近のデータも確認（末尾）
  const res2 = await sheets.spreadsheets.values.get({
    spreadsheetId: '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk',
    range: 'TT_オプト!A:Z',
  });
  const allRows = res2.data.values || [];
  console.log(`\n総行数: ${allRows.length}`);
  console.log('\n=== 末尾5行 ===');
  for (let i = Math.max(1, allRows.length - 5); i < allRows.length; i++) {
    const parts: string[] = [];
    for (let j = 0; j < allRows[i].length; j++) {
      if (allRows[i][j] && String(allRows[i][j]).trim()) {
        parts.push(`[${j}]${String(allRows[i][j]).substring(0, 80)}`);
      }
    }
    console.log(`row${i}: ${parts.join(' | ')}`);
  }
}
main().catch(console.error);
