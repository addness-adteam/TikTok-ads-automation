import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

const SPREADSHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function main() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // まずシート一覧を取得
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  console.log('=== シート一覧 ===');
  for (const sheet of spreadsheet.data.sheets || []) {
    console.log(`  - ${sheet.properties?.title}`);
  }

  // AIタブのデータを確認
  console.log('\n=== AIタブ サンプルデータ ===');
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'AI!A:AZ',
  });

  const rows = response.data.values || [];
  console.log(`行数: ${rows.length}`);

  if (rows.length > 0) {
    // ヘッダー行を確認
    console.log('\nヘッダー行（列番号付き）:');
    const header = rows[0];
    for (let i = 0; i < header.length; i++) {
      if (header[i]) {
        console.log(`  [${i}] ${header[i]}`);
      }
    }

    // 最初の数行のデータを確認
    console.log('\nデータ行サンプル（最初の5行）:');
    for (let i = 1; i < Math.min(6, rows.length); i++) {
      const row = rows[i];
      console.log(`\n  行${i}:`);
      console.log(`    [0] A列(日付): ${row[0] || '(空)'}`);
      console.log(`    [46] AU列(経路): ${row[46] || '(空)'}`);
      // 近くの列も確認
      for (let j = 40; j < Math.min(52, row.length); j++) {
        if (row[j]) {
          console.log(`    [${j}] : ${String(row[j]).substring(0, 80)}`);
        }
      }
    }

    // 2月のデータがあるか確認
    console.log('\n\n=== 2026年2月のデータ確認 ===');
    let febCount = 0;
    let febWithPath = 0;
    for (let i = 1; i < rows.length; i++) {
      const dateStr = String(rows[i][0] || '');
      if (dateStr.includes('2026') && (dateStr.includes('/2/') || dateStr.includes('-02-') || dateStr.includes('2月'))) {
        febCount++;
        if (rows[i][46]) {
          febWithPath++;
          if (febWithPath <= 5) {
            console.log(`  行${i}: 日付=${dateStr}, AU列=${String(rows[i][46]).substring(0, 100)}`);
          }
        }
      }
    }
    console.log(`\n2月の行数: ${febCount}`);
    console.log(`2月でAU列にデータがある行数: ${febWithPath}`);
  }
}

main().catch(console.error);
