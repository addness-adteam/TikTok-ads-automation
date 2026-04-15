/**
 * V2がCR01207のCVを何件と認識しているか直接確認
 * V2と同じロジックでCVカウントを実行
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // V2が使うスプレッドシート（AI導線のcvSpreadsheetUrl）
  // Appeal 'AI' の cvSpreadsheetUrl を直接指定
  const spreadsheetId = '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk';

  console.log('=== V2のCV認識デバッグ ===\n');

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'TT_オプト!A:Z',
  });
  const rows = res.data.values || [];
  const header = rows[0] || [];

  // ヘッダーからカラム特定（V2と同じロジック）
  let pathCol = -1, dateCol = -1;
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] || '').trim();
    if (['登録経路', '流入経路', 'ファネル登録経路', 'registration_path', 'path'].includes(h)) pathCol = i;
    if (['登録日時', '登録日', 'date', 'created_at', 'timestamp', 'アクション実行日時', '実行日時'].includes(h)) dateCol = i;
  }
  console.log(`pathCol: ${pathCol} (${header[pathCol]}), dateCol: ${dateCol} (${header[dateCol]})`);

  // V2が使う登録経路
  // generateRegistrationPath: `TikTok広告-${appealName}-${lpName}`
  // CR01207の広告名: 260411/横展開/CR454_横展開/LP1-CR01207
  // → lpName = LP1, appealName = AI
  // → registrationPath = 'TikTok広告-AI-LP1'  ← これが問題！CRを含まない！

  const registrationPathV2 = 'TikTok広告-AI-LP1'; // V2が実際に使うパス
  const registrationPathFull = 'TikTok広告-AI-LP1-CR01207'; // 正確なパス

  // 今日のJST日付
  const jstNow = new Date(Date.now() + 9 * 3600000);
  const todayStr = `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(jstNow.getUTCDate()).padStart(2, '0')}`;

  console.log(`\n今日: ${todayStr}`);
  console.log(`V2の登録経路: '${registrationPathV2}'`);
  console.log(`正確な登録経路: '${registrationPathFull}'`);

  // V2のロジックで今日のCV数をカウント
  let cvCountV2 = 0;
  let cvCountFull = 0;
  const matchedPathsV2: string[] = [];
  const matchedPathsFull: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const regPath = String(rows[i]?.[pathCol] || '').trim();
    const dateVal = String(rows[i]?.[dateCol] || '').trim();

    // 日付チェック（今日のみ）
    if (!dateVal.startsWith(todayStr) && !dateVal.startsWith(todayStr.replace(/-/g, '/'))) continue;

    // V2のマッチング: 完全一致
    if (regPath === registrationPathV2) {
      cvCountV2++;
      matchedPathsV2.push(`${dateVal} | ${regPath}`);
    }

    // 正確なマッチング
    if (regPath === registrationPathFull) {
      cvCountFull++;
      matchedPathsFull.push(`${dateVal} | ${regPath}`);
    }

    // 部分一致でLP1を含むもの全部
    if (regPath.includes('TikTok広告-AI-LP1')) {
      // デバッグ用に記録
    }
  }

  console.log(`\nV2が認識するCV数 ('${registrationPathV2}'完全一致): ${cvCountV2}件`);
  for (const m of matchedPathsV2) console.log(`  ${m}`);

  console.log(`\n正確なCV数 ('${registrationPathFull}'完全一致): ${cvCountFull}件`);
  for (const m of matchedPathsFull) console.log(`  ${m}`);

  // LP1を含む今日の全登録経路を表示（V2がどれを拾っているか確認）
  console.log(`\n今日の 'TikTok広告-AI-LP1' を含む全行:`);
  let totalLP1Today = 0;
  for (let i = 1; i < rows.length; i++) {
    const regPath = String(rows[i]?.[pathCol] || '').trim();
    const dateVal = String(rows[i]?.[dateCol] || '').trim();
    if (!dateVal.startsWith(todayStr) && !dateVal.startsWith(todayStr.replace(/-/g, '/'))) continue;
    if (regPath.startsWith('TikTok広告-AI-LP1')) {
      console.log(`  ${dateVal} | ${regPath}`);
      totalLP1Today++;
    }
  }
  console.log(`合計: ${totalLP1Today}件`);

  // V2のgenerateRegistrationPathの実装を確認
  console.log('\n=== V2のgenerateRegistrationPath確認 ===');
  console.log('V2はCR番号を含まず "TikTok広告-AI-LP1" で検索する。');
  console.log('つまりLP1の全CRのCVが合算されてカウントされる。');
  console.log(`→ 今日のLP1全体のCV: ${totalLP1Today}件`);
  console.log(`→ CR01207単体のCV: ${cvCountFull}件`);
  if (totalLP1Today > cvCountFull) {
    console.log(`\n⚠ V2は ${totalLP1Today}CV と認識するが、CR01207は ${cvCountFull}CV しかない！`);
    console.log(`→ 他のCRのCVも拾って増額判定している = バグ！`);
  }
}

main().catch(console.error);
