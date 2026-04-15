/**
 * スキルプラスシートのヘッダーとサンプルデータを確認
 * npx tsx apps/backend/check-sp-sheet-structure.ts
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

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `スキルプラス（オートウェビナー用）!A:AZ`,
  });
  const rows: any[][] = res.data.values || [];

  // ヘッダー行
  console.log('=== ヘッダー（1行目） ===');
  const header = rows[0] || [];
  for (let i = 0; i < header.length; i++) {
    if (header[i]) console.log(`  col ${i}: ${header[i]}`);
  }

  // 直近7日のデータからセミナー着座に関連しそうな列を確認
  console.log('\n=== 直近データサンプル（セミナー着座関連列） ===');
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const endDate = new Date(`${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(jstNow.getUTCDate()).padStart(2, '0')}T23:59:59+09:00`);
  const startDate = new Date(endDate.getTime() - 7 * 86400000);

  let count = 0;
  for (let i = 1; i < rows.length && count < 20; i++) {
    const row = rows[i];
    const dateStr = String(row[0] || '').trim();
    const m = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (!m) continue;
    const rowDate = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), -9, 0, 0));
    if (rowDate < startDate || rowDate > endDate) continue;

    // 全列を表示（値がある列のみ）
    const parts: string[] = [];
    for (let j = 0; j < row.length; j++) {
      if (row[j] && String(row[j]).trim()) {
        parts.push(`[${j}]${String(row[j]).substring(0, 60)}`);
      }
    }
    console.log(`  row${i}: ${parts.join(' | ')}`);
    count++;
  }
}
main().catch(console.error);
