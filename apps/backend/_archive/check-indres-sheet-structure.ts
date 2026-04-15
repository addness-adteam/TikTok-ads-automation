/**
 * 個別予約スプレッドシートの構造確認
 * メールアドレスが含まれているか、成約突合に使えるカラムがあるか調査
 *
 * npx tsx apps/backend/check-indres-sheet-structure.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

import { google } from 'googleapis';

const SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. AIシートのヘッダー（1行目）を全カラム表示
  console.log('=== AIシート 全ヘッダー ===\n');
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'AI!1:3', // ヘッダー+2行サンプル
  });
  const allRows = headerRes.data.values || [];
  const headers = allRows[0] || [];

  for (let i = 0; i < Math.max(headers.length, 52); i++) {
    const colLetter = i < 26
      ? String.fromCharCode(65 + i)
      : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
    const header = headers[i] || '(空)';
    const sample1 = allRows[1]?.[i] || '';
    const sample2 = allRows[2]?.[i] || '';
    console.log(`${colLetter}列 (${String(i).padStart(2)}): ${header}`);
    if (sample1 || sample2) {
      console.log(`         サンプル: ${sample1} | ${sample2}`);
    }
  }

  // 2. メールアドレスっぽいデータがある列を探す
  console.log('\n\n=== メールアドレス検索 ===\n');
  const fullRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'AI!A:AZ',
  });
  const rows = fullRes.data.values || [];

  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const colsWithEmail = new Map<number, number>();

  for (let i = 1; i < Math.min(rows.length, 100); i++) { // 先頭100行をスキャン
    const row = rows[i];
    for (let j = 0; j < (row?.length || 0); j++) {
      if (row[j] && emailPattern.test(row[j])) {
        colsWithEmail.set(j, (colsWithEmail.get(j) || 0) + 1);
      }
    }
  }

  if (colsWithEmail.size > 0) {
    console.log('メールアドレスが含まれるカラム:');
    for (const [col, count] of [...colsWithEmail.entries()].sort((a, b) => b[1] - a[1])) {
      const colLetter = col < 26
        ? String.fromCharCode(65 + col)
        : String.fromCharCode(64 + Math.floor(col / 26)) + String.fromCharCode(65 + (col % 26));
      const header = headers[col] || '(空)';
      // サンプル表示
      let sample = '';
      for (let i = 1; i < rows.length; i++) {
        if (rows[i]?.[col] && emailPattern.test(rows[i][col])) {
          sample = rows[i][col].substring(0, 30) + '...';
          break;
        }
      }
      console.log(`  ${colLetter}列 (${col}): "${header}" | ${count}件 | 例: ${sample}`);
    }
  } else {
    console.log('メールアドレスは見つかりませんでした');
  }

  // 3. 名前・LINE名など個人特定できるカラムを探す
  console.log('\n\n=== 個人特定可能なカラム ===\n');
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] || '').toLowerCase();
    if (h.includes('名前') || h.includes('name') || h.includes('line') ||
        h.includes('メール') || h.includes('email') || h.includes('tel') ||
        h.includes('電話') || h.includes('id') || h.includes('顧客')) {
      const colLetter = i < 26
        ? String.fromCharCode(65 + i)
        : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
      const nonEmpty = rows.filter((r, idx) => idx > 0 && r[i]).length;
      console.log(`  ${colLetter}列 (${i}): "${headers[i]}" | 値あり: ${nonEmpty}行`);
    }
  }

  // 4. 対象CRの行の全カラム値をダンプ（1件だけ）
  console.log('\n\n=== LP1-CR00928 のサンプル行（全カラム）===\n');
  for (let i = 1; i < rows.length; i++) {
    const pathCell = rows[i]?.[46] || '';
    if (pathCell.includes('CR00928')) {
      const row = rows[i];
      for (let j = 0; j < row.length; j++) {
        if (row[j]) {
          const colLetter = j < 26
            ? String.fromCharCode(65 + j)
            : String.fromCharCode(64 + Math.floor(j / 26)) + String.fromCharCode(65 + (j % 26));
          console.log(`  ${colLetter}列 (${j}): ${row[j]}`);
        }
      }
      break; // 1件だけ
    }
  }
}

main().catch(console.error);
