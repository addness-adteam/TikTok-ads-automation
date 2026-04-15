import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { google } from 'googleapis';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS ?? '{}');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() as any });

  // 1) 数値管理シート (UTAGEスプシ内のスキルプラス（オートウェビナー用）)
  console.log('='.repeat(100));
  console.log('【数値管理シート】');
  console.log('='.repeat(100));
  const KPI_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';
  const KPI_TAB = 'スキルプラス(オートウェビナー用)'; // 全角カッコで試す
  // まずタブ一覧を取得
  const meta = await sheets.spreadsheets.get({ spreadsheetId: KPI_SHEET_ID });
  console.log('シートタブ一覧:');
  for (const s of meta.data.sheets ?? []) console.log('  -', s.properties?.title);

  // 正確なタブ名を拾う
  const kpiTab = meta.data.sheets?.find(s => s.properties?.title?.includes('スキルプラス') && s.properties?.title?.includes('オートウェビナー'))?.properties?.title;
  console.log(`\n→ 使用タブ: "${kpiTab}"`);

  if (kpiTab) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: KPI_SHEET_ID,
      range: `${kpiTab}!A1:AZ200`,
    });
    const rows = res.data.values ?? [];
    console.log(`行数: ${rows.length}, 列数(最大): ${Math.max(...rows.map(r => r.length))}`);

    // 月次KPI行を特定: 2026-04 や 2026/4 を含む行
    console.log('\n日付らしき値を含む行（上位10件）:');
    let count = 0;
    for (let i = 0; i < rows.length && count < 10; i++) {
      const joined = rows[i].join(' | ');
      if (/202[56][\/\-年]\s*0?[0-9]{1,2}/.test(joined)) {
        console.log(`  [row ${i}] ${joined.slice(0, 150)}`);
        count++;
      }
    }

    // 「セミナー着座CPO」という文字列を探す
    console.log('\n"セミナー着座CPO" 関連セル:');
    for (let i = 0; i < rows.length; i++) {
      for (let c = 0; c < (rows[i]?.length ?? 0); c++) {
        const v = String(rows[i][c] ?? '');
        if (/セミナー着座CPO|セミナー.*CPO|着座CPO/.test(v)) {
          console.log(`  [${i},${c}] "${v}"`);
        }
      }
    }

    // ヘッダー候補（1〜3行目）
    console.log('\n最初の5行:');
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      console.log(`  row${i}: ${(rows[i] ?? []).slice(0, 20).join(' | ')}`);
    }
  }

  // 2) 予約者アンケートシート
  console.log('\n' + '='.repeat(100));
  console.log('【予約者アンケートシート】');
  console.log('='.repeat(100));
  const SURVEY_ID = '1iKwplhJwldYqnr89NFoF5z3WS4GqnFVKBNfOdTZMF9c';
  try {
    const meta2 = await sheets.spreadsheets.get({ spreadsheetId: SURVEY_ID });
    console.log('シートタブ一覧:');
    for (const s of meta2.data.sheets ?? []) console.log('  -', s.properties?.title);

    // 最初のタブで内容プローブ
    const firstTab = meta2.data.sheets?.[0]?.properties?.title;
    if (firstTab) {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SURVEY_ID,
        range: `${firstTab}!A1:Z20`,
      });
      const rows = res.data.values ?? [];
      console.log(`\n→ "${firstTab}" 先頭5行:`);
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        console.log(`  row${i}: ${(rows[i] ?? []).slice(0, 15).join(' | ').slice(0, 300)}`);
      }
      // ヘッダー + H列中身確認
      console.log('\nヘッダー (row0):');
      rows[0]?.forEach((h, i) => console.log(`  col${i} (${String.fromCharCode(65+i)}): "${h}"`));
    }
  } catch (e: any) {
    console.log(`エラー: ${e.message}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
