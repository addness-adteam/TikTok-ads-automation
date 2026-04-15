import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { google } from 'googleapis';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS ?? '{}');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() as any });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA',
    range: 'スキルプラス（オートウェビナー用）!A1:AZ500',
  });
  const rows = res.data.values ?? [];

  // "許容セミナー着座CPO" ラベルの行と、隣接セルを詳しく見る
  console.log('=== "許容セミナー着座CPO" 行と周辺値 ===');
  for (let i = 0; i < rows.length; i++) {
    for (let c = 0; c < (rows[i]?.length ?? 0); c++) {
      if (/セミナー着座CPO/.test(String(rows[i][c] ?? ''))) {
        console.log(`\n[row ${i}, col ${c}] label="${rows[i][c]}"`);
        // 同じ行の周辺（col c-2 〜 c+5）
        const neighbors: string[] = [];
        for (let k = Math.max(0, c - 2); k <= c + 5; k++) {
          neighbors.push(`col${k}="${rows[i][k] ?? ''}"`);
        }
        console.log(`  同行: ${neighbors.join(' | ')}`);
        // 月ブロックの先頭行を遡って探す: 同行〜上20行で "202X/X/1" 日付を探す
        for (let back = 0; back < 20; back++) {
          const prevRow = rows[i - back] ?? [];
          if (prevRow[0] && /202\d[\/\-]\d{1,2}[\/\-]1$/.test(String(prevRow[0]))) {
            console.log(`  → 月ブロック開始: row ${i - back} date="${prevRow[0]}"`);
            break;
          }
          // 「〇月分」表記も対象
          if (prevRow[0] && /\d+月分/.test(String(prevRow[0]))) {
            console.log(`  → 月ブロック開始: row ${i - back} label="${prevRow[0]}"`);
            break;
          }
        }
      }
    }
  }

  // 月ブロックの先頭行（"〇月分" 含む行）を全列挙
  console.log('\n=== "〇月分" 行一覧 ===');
  for (let i = 0; i < rows.length; i++) {
    const a = String(rows[i]?.[0] ?? '');
    if (/\d+月分/.test(a)) {
      console.log(`  row ${i}: A="${a}"`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
