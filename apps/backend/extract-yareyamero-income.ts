/**
 * やれやめろCR（CR00839, CR00835, CR00797）のメールアドレスを
 * メルアドリストから抽出し、年収データと照合するスクリプト
 */
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

// メルアドリスト（AI導線）
const EMAIL_LIST_SPREADSHEET_ID = '13x6k01kuazOc03pSJYYeDheWsAxXmD11OCUXluzwAGM';
const EMAIL_LIST_SHEET_NAME = 'TikTok広告_AI_メールアドレス一覧';

// 年収データ
const INCOME_SPREADSHEET_ID = '14Fy7JBSGbW65xLSqhPnSw5V6dranfH1HXPV1l6j73Uk';
const INCOME_SHEET_NAME = 'シート1';

// 対象CR
const TARGET_CRS = ['CR00839', 'CR00835', 'CR00797'];

async function main() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  console.log('=== やれやめろCR メールアドレス × 年収データ照合 ===\n');
  console.log(`対象CR: ${TARGET_CRS.join(', ')}\n`);

  // ========================================
  // Step 1: メルアドリストから対象CRのメールアドレスを抽出
  // ========================================
  console.log('--- Step 1: メルアドリストから対象CRのメールアドレスを抽出 ---');
  const emailListResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: EMAIL_LIST_SPREADSHEET_ID,
    range: `${EMAIL_LIST_SHEET_NAME}!A:B`,
  });

  const emailRows = emailListResponse.data.values || [];
  console.log(`  メルアドリスト総行数: ${emailRows.length - 1}`);

  // 対象CRのメールアドレスを抽出
  const targetEmails: { email: string; registrationPath: string; cr: string }[] = [];

  for (let i = 1; i < emailRows.length; i++) {
    const email = emailRows[i][0]?.toString().trim();
    const regPath = emailRows[i][1]?.toString().trim();
    if (!email || !regPath) continue;

    for (const targetCR of TARGET_CRS) {
      if (regPath.toUpperCase().includes(targetCR)) {
        targetEmails.push({ email, registrationPath: regPath, cr: targetCR });
        break;
      }
    }
  }

  console.log(`  対象CRのメールアドレス数: ${targetEmails.length}\n`);

  for (const item of targetEmails) {
    console.log(`  ${item.cr}: ${item.email} (${item.registrationPath})`);
  }

  // ========================================
  // Step 2: 年収データを取得
  // ========================================
  console.log('\n--- Step 2: 年収データを取得 ---');
  const incomeResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: INCOME_SPREADSHEET_ID,
    range: `${INCOME_SHEET_NAME}!A:Z`,
  });

  const incomeRows = incomeResponse.data.values || [];
  console.log(`  年収データ総行数: ${incomeRows.length - 1}`);

  // ヘッダー表示
  if (incomeRows.length > 0) {
    console.log(`  ヘッダー: ${incomeRows[0].join(' | ')}`);
  }

  // メールアドレスをキーに年収データのマップを作成
  const incomeMap = new Map<string, { date: string; lineName: string; income: string; allData: string[] }>();
  for (let i = 1; i < incomeRows.length; i++) {
    const row = incomeRows[i];
    const date = row[0]?.toString().trim() || '';
    const lineName = row[1]?.toString().trim() || '';
    const income = row[2]?.toString().trim() || '';
    const email = row[3]?.toString().trim().toLowerCase() || '';

    if (email) {
      incomeMap.set(email, { date, lineName, income, allData: row });
    }
  }
  console.log(`  年収データ（メールあり）: ${incomeMap.size}件`);

  // ========================================
  // Step 3: 照合結果を出力
  // ========================================
  console.log('\n\n========================================');
  console.log('=== 照合結果: やれやめろCR × 年収データ ===');
  console.log('========================================\n');

  let matchCount = 0;
  let noMatchCount = 0;

  // CR別にグループ化
  for (const targetCR of TARGET_CRS) {
    const crEmails = targetEmails.filter(e => e.cr === targetCR);
    console.log(`\n--- ${targetCR} (${crEmails.length}件) ---`);

    for (const item of crEmails) {
      const incomeData = incomeMap.get(item.email.toLowerCase());
      if (incomeData) {
        matchCount++;
        console.log(`  ✅ ${item.email}`);
        console.log(`     LINE名: ${incomeData.lineName}`);
        console.log(`     年収: ${incomeData.income}`);
        console.log(`     面談予約日: ${incomeData.date}`);
      } else {
        noMatchCount++;
        console.log(`  ❌ ${item.email} → 年収データなし`);
      }
    }
  }

  // サマリー
  console.log('\n\n========================================');
  console.log('=== サマリー ===');
  console.log('========================================');
  console.log(`  対象メールアドレス数: ${targetEmails.length}`);
  console.log(`  年収データあり: ${matchCount}件`);
  console.log(`  年収データなし: ${noMatchCount}件`);

  // 年収分布
  if (matchCount > 0) {
    console.log('\n--- 年収分布 ---');
    const incomeDist = new Map<string, number>();
    for (const item of targetEmails) {
      const incomeData = incomeMap.get(item.email.toLowerCase());
      if (incomeData) {
        const key = incomeData.income || '不明';
        incomeDist.set(key, (incomeDist.get(key) || 0) + 1);
      }
    }
    for (const [income, count] of incomeDist) {
      console.log(`  ${income}: ${count}件`);
    }
  }
}

main().catch(console.error);
