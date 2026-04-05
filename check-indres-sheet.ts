import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, 'apps/backend/.env') });

const { google } = require('googleapis');

const INDIVIDUAL_RESERVATION_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // AIシートの全データ取得
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: INDIVIDUAL_RESERVATION_SHEET_ID,
    range: 'AI!A:AZ',
  });
  const rows = res.data.values || [];

  console.log(`AIシート: ${rows.length}行`);

  // ヘッダー表示（特にA列と46列目=AU列）
  if (rows.length > 0) {
    const header = rows[0];
    console.log(`\nヘッダー行（全${header.length}列）:`);
    console.log(`  A列(0): "${header[0]}"`);
    console.log(`  AU列(46): "${header[46] || '(なし)'}"`);
    // 周辺も表示
    for (let i = 43; i <= 50 && i < header.length; i++) {
      console.log(`  列${i} (${String.fromCharCode(65 + Math.floor(i/26) - 1)}${String.fromCharCode(65 + i%26)}): "${header[i]}"`);
    }
  }

  // 直近の行を20行表示（A列=日付, AU列=登録経路）
  console.log(`\n--- 直近20行のA列(日付)とAU列(46列目=登録経路) ---`);
  const startIdx = Math.max(1, rows.length - 20);
  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    const dateVal = row[0] || '(空)';
    const pathVal = row[46] || '(空)';
    // 2026/03 のデータかどうかも確認
    console.log(`  行${i+1}: 日付="${dateVal}" | 登録経路(46)="${pathVal}"`);
  }

  // 3月のデータだけフィルタ
  console.log(`\n--- 2026/03 のデータ ---`);
  let marchCount = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateStr = String(row[0] || '');
    if (dateStr.includes('2026/03') || dateStr.includes('2026-03')) {
      marchCount++;
      const pathVal = row[46] || '(空)';
      console.log(`  行${i+1}: 日付="${dateStr}" | 登録経路(46)="${pathVal}"`);
    }
  }
  console.log(`\n3月の個別予約: ${marchCount}件`);

  // 全行で「TikTok」を含む登録経路があるか検索
  console.log(`\n--- 登録経路に "TikTok" を含む行（全期間） ---`);
  let tiktokCount = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const pathVal = String(row[46] || '');
    if (pathVal.includes('TikTok') || pathVal.includes('tiktok')) {
      tiktokCount++;
      if (tiktokCount <= 20) {
        console.log(`  行${i+1}: 日付="${row[0]}" | 経路="${pathVal}"`);
      }
    }
  }
  console.log(`TikTok含む経路: ${tiktokCount}件`);

  // もしかして別の列に登録経路がある？全列をスキャンして「LP」「CR」「TikTok」を含む列を探す
  console.log(`\n--- 「TikTok」「LP-CR」を含むセルがある列の探索（直近10行） ---`);
  const searchStart = Math.max(1, rows.length - 10);
  const colHits = new Map<number, string[]>();
  for (let i = searchStart; i < rows.length; i++) {
    const row = rows[i];
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] || '');
      if (val.includes('TikTok') || val.match(/LP\d+-CR\d+/i)) {
        if (!colHits.has(c)) colHits.set(c, []);
        colHits.get(c)!.push(`行${i+1}: "${val.substring(0, 80)}"`);
      }
    }
  }
  for (const [col, hits] of colHits) {
    console.log(`  列${col}: ${hits.length}件`);
    for (const h of hits) console.log(`    ${h}`);
  }
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
