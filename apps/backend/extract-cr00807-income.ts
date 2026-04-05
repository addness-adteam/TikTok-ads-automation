/**
 * CR00807のメールアドレスを抽出し、年収データと照合するスクリプト
 */
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

const EMAIL_LIST_SPREADSHEET_ID = '13x6k01kuazOc03pSJYYeDheWsAxXmD11OCUXluzwAGM';
const EMAIL_LIST_SHEET_NAME = 'TikTok広告_AI_メールアドレス一覧';
const INCOME_SPREADSHEET_ID = '14Fy7JBSGbW65xLSqhPnSw5V6dranfH1HXPV1l6j73Uk';
const INCOME_SHEET_NAME = 'シート1';

const TARGET_CR = 'CR00807';

async function main() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  console.log(`=== ${TARGET_CR} メールアドレス × 年収データ照合 ===\n`);

  // メルアドリストから対象CRのメールアドレスを抽出
  const emailListResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: EMAIL_LIST_SPREADSHEET_ID,
    range: `${EMAIL_LIST_SHEET_NAME}!A:B`,
  });

  const emailRows = emailListResponse.data.values || [];
  const targetEmails: { email: string; registrationPath: string }[] = [];

  for (let i = 1; i < emailRows.length; i++) {
    const email = emailRows[i][0]?.toString().trim();
    const regPath = emailRows[i][1]?.toString().trim();
    if (!email || !regPath) continue;
    if (regPath.toUpperCase().includes(TARGET_CR)) {
      targetEmails.push({ email, registrationPath: regPath });
    }
  }

  console.log(`メルアドリストから${TARGET_CR}のメールアドレス: ${targetEmails.length}件\n`);
  for (const item of targetEmails) {
    console.log(`  ${item.email} (${item.registrationPath})`);
  }

  // 年収データを取得
  const incomeResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: INCOME_SPREADSHEET_ID,
    range: `${INCOME_SHEET_NAME}!A:Z`,
  });

  const incomeRows = incomeResponse.data.values || [];
  const incomeMap = new Map<string, { date: string; lineName: string; income: string }>();
  for (let i = 1; i < incomeRows.length; i++) {
    const row = incomeRows[i];
    const email = row[3]?.toString().trim().toLowerCase() || '';
    if (email) {
      incomeMap.set(email, {
        date: row[0]?.toString().trim() || '',
        lineName: row[1]?.toString().trim() || '',
        income: row[2]?.toString().trim() || '',
      });
    }
  }

  // 照合結果
  console.log(`\n=== 照合結果 ===\n`);
  let matchCount = 0;
  for (const item of targetEmails) {
    const incomeData = incomeMap.get(item.email.toLowerCase());
    if (incomeData) {
      matchCount++;
      console.log(`✅ ${item.email}`);
      console.log(`   LINE名: ${incomeData.lineName} / 年収: ${incomeData.income} / 面談予約日: ${incomeData.date}`);
    } else {
      console.log(`❌ ${item.email} → 年収データなし`);
    }
  }

  console.log(`\n一致: ${matchCount}件 / 全${targetEmails.length}件`);
}

main().catch(console.error);
