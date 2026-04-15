import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { google } from 'googleapis';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS ?? '{}');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() as any });

  const id = '1iKwplhJwldYqnr89NFoF5z3WS4GqnFVKBNfOdTZMF9c';
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  console.log('シートタブ一覧:');
  for (const s of meta.data.sheets ?? []) console.log('  -', s.properties?.title);

  const firstTab = meta.data.sheets?.[0]?.properties?.title;
  if (!firstTab) return;
  console.log(`\n→ "${firstTab}" を探索\n`);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${firstTab}!A1:Z10`,
  });
  const rows = res.data.values ?? [];
  console.log(`ヘッダー (row 0):`);
  rows[0]?.forEach((h, i) => console.log(`  col${i} (${String.fromCharCode(65+i)}): "${h}"`));
  console.log(`\nサンプル行 (row 1):`);
  rows[1]?.forEach((v, i) => console.log(`  col${i} (${String.fromCharCode(65+i)}): "${String(v).slice(0, 100)}"`));

  // メアドらしき列を特定
  console.log('\n=== メアドを含む列 ===');
  const emailCols = new Set<number>();
  for (const row of rows.slice(1)) {
    for (let c = 0; c < row.length; c++) {
      if (typeof row[c] === 'string' && /@[\w.-]+\.\w+/.test(row[c])) {
        emailCols.add(c);
      }
    }
  }
  for (const c of emailCols) console.log(`  col${c}: ヘッダー="${rows[0]?.[c]}"`);

  // 日時らしき列
  console.log('\n=== 日時を含む列 ===');
  const dateCols = new Set<number>();
  for (const row of rows.slice(1)) {
    for (let c = 0; c < row.length; c++) {
      if (typeof row[c] === 'string' && /\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(row[c])) {
        dateCols.add(c);
      }
    }
  }
  for (const c of dateCols) console.log(`  col${c}: ヘッダー="${rows[0]?.[c]}" サンプル="${rows[1]?.[c]}"`);

  // 総行数
  const all = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${firstTab}!A:A`,
  });
  console.log(`\n総行数: ${all.data.values?.length ?? 0}`);
}
main().catch(e => { console.error(e); process.exit(1); });
