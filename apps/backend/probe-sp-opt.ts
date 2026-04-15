import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { google } from 'googleapis';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS ?? '{}');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() as any });

  const id = '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk';
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  console.log('タブ一覧:');
  for (const s of meta.data.sheets ?? []) console.log('  -', s.properties?.title);

  // TT_オプト があればそれ使う、なければ最初のタブ
  const tab = meta.data.sheets?.find(s => s.properties?.title === 'TT_オプト')?.properties?.title
            ?? meta.data.sheets?.[0]?.properties?.title;
  console.log(`\n→ 使用タブ: "${tab}"`);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${tab}!A1:Z20`,
  });
  const rows = res.data.values ?? [];
  console.log(`\nヘッダー:`);
  rows[0]?.forEach((h, i) => console.log(`  col${i} (${String.fromCharCode(65+i)}): "${h}"`));
  console.log(`\nサンプル行(1-3):`);
  for (const r of rows.slice(1, 4)) console.log('  ', r.map(v => String(v).slice(0, 80)).join(' | '));

  // 総行数
  const resCount = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${tab}!A:A`,
  });
  console.log(`\n総行数: ${resCount.data.values?.length ?? 0}`);
}
main().catch(e => { console.error(e); process.exit(1); });
