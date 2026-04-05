/**
 * スプレッドシート構造調査
 * フロント購入者/未購入者の個別予約率を出すために必要なデータ構造を確認
 */
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
dotenv.config();

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheetsApi = google.sheets({ version: 'v4', auth });

async function getValues(spreadsheetId: string, range: string): Promise<string[][]> {
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  return (res.data.values || []) as string[][];
}

async function getSheetNames(spreadsheetId: string): Promise<string[]> {
  const res = await sheetsApi.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  return (res.data.sheets || []).map(s => s.properties?.title || '');
}

const FRONT_SHEET_ID = '1PvyM6JkFuQR_lc4QyZFaMX0GA0Rn0_6Bll9mjh0RNFs';
const CV_SHEET_ID = '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk';
const INDRES_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function main() {
  // === 1. フロント購入スプレッドシート ===
  console.log('=== フロント購入シート ===');
  const frontSheets = await getSheetNames(FRONT_SHEET_ID);
  console.log('シート一覧:', frontSheets);

  for (const sheetName of frontSheets.filter(s => s.includes('TT'))) {
    console.log(`\n--- ${sheetName} ---`);
    const rows = await getValues(FRONT_SHEET_ID, `'${sheetName}'!A1:Z5`);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      console.log(`行${i + 1}: ${row.map((v, j) => `[${j}]${v}`).join(' | ')}`);
    }
  }

  // === 2. CV（オプトイン）スプレッドシート ===
  console.log('\n\n=== CV（オプトイン）シート ===');
  const cvSheets = await getSheetNames(CV_SHEET_ID);
  console.log('シート一覧:', cvSheets);

  for (const sheetName of cvSheets.filter(s => s.includes('TT') || s.includes('オプト'))) {
    console.log(`\n--- ${sheetName} ---`);
    const rows = await getValues(CV_SHEET_ID, `'${sheetName}'!A1:Z5`);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      console.log(`行${i + 1}: ${row.map((v, j) => `[${j}]${v}`).join(' | ')}`);
    }
  }

  // === 3. 個別予約スプレッドシート（AIシート、AU列周辺を確認） ===
  console.log('\n\n=== 個別予約シート（AI） ===');
  const indresSheets = await getSheetNames(INDRES_SHEET_ID);
  console.log('シート一覧:', indresSheets);

  // AIシートのAU列周辺を確認（個別予約の登録経路データ）
  // まず2026年3月のデータ範囲を探す
  const allA = await getValues(INDRES_SHEET_ID, `'AI'!A1:A600`);
  let marchStart = -1;
  for (let i = 0; i < allA.length; i++) {
    const val = (allA[i]?.[0] || '').trim();
    if (val === '3月') {
      const next = (allA[i + 1]?.[0] || '').trim();
      if (next.startsWith('2026/3/') || next.startsWith('2026/03/')) {
        marchStart = i + 1; // 0-indexed
        break;
      }
    }
  }
  if (marchStart > 0) {
    console.log(`\n3月データ開始行: ${marchStart + 1}`);
    // AU列(46)周辺を5行分読む
    const rows = await getValues(INDRES_SHEET_ID, `'AI'!A${marchStart + 1}:AV${marchStart + 6}`);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      console.log(`\n行${marchStart + 1 + i}: date=${row[0]}, optins=${row[11]}, front=${row[21]}, indRes=${row[38]}, path=${(row[46] || '').substring(0, 200)}`);
    }
  }

  // === 4. 個別予約のユーザーレベルデータを探す ===
  // 個別予約シート内に他のシートがあるか確認
  console.log('\n\n=== 個別予約スプレッドシートの全シート ===');
  for (const sheetName of indresSheets) {
    if (sheetName === 'AI' || sheetName === 'SNS' || sheetName.includes('スキルプラス')) continue;
    console.log(`\n--- ${sheetName} ---`);
    try {
      const rows = await getValues(INDRES_SHEET_ID, `'${sheetName}'!A1:Z3`);
      for (let i = 0; i < rows.length; i++) {
        console.log(`行${i + 1}: ${rows[i].map((v, j) => `[${j}]${v}`).join(' | ')}`);
      }
    } catch (e: any) {
      console.log(`  読取エラー: ${e.message}`);
    }
  }
}

main().catch(console.error);
