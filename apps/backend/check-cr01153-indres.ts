import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { google } from 'googleapis';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS ?? '{}');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() as any });

  // 個別予約シート (calculate-ai-cpo-per-cr.tsで使用)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: '13x6k01kuazOc03pSJYYeDheWsAxXmD11OCUXluzwAGM',
    range: 'TikTok広告_AI_メールアドレス一覧!A:D',
  });
  const rows = res.data.values ?? [];
  console.log(`個別予約AI シート行数: ${rows.length}`);
  console.log('ヘッダー:', rows[0]);
  console.log('サンプル行3件:');
  for (const r of rows.slice(1, 4)) console.log(' ', r);

  // CR01153マッチ
  console.log(`\n=== CR01153 マッチ行 ===`);
  let matches = 0;
  for (let i = 1; i < rows.length; i++) {
    const joined = rows[i].join(' | ');
    if (/CR0?1153/i.test(joined)) {
      console.log(`[row ${i}] ${rows[i].join(' | ').slice(0, 200)}`);
      matches++;
    }
  }
  console.log(`計 ${matches} 件`);

  // 4/4横展開15CRすべてについて件数集計
  console.log(`\n=== 4/4横展開15CR 個別予約件数 ===`);
  const targets = ['CR01146','CR01147','CR01148','CR01149','CR01150','CR01151','CR01152','CR01153','CR01154','CR01155','CR01156','CR01157','CR01158','CR01159','CR01160'];
  const counts: Record<string, number> = {};
  for (const t of targets) counts[t] = 0;
  for (const row of rows.slice(1)) {
    const path = row[1] ?? '';
    for (const t of targets) {
      const re = new RegExp(`LP\\d+-${t}\\b|${t}\\b`, 'i');
      if (re.test(String(path))) counts[t] += 1;
    }
  }
  for (const [cr, n] of Object.entries(counts)) console.log(`  ${cr}: ${n}件`);
}
main().catch(e => { console.error(e); process.exit(1); });
