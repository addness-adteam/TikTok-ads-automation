/**
 * 個別予約スプレッドシートのTikTok広告関連データを詳細確認
 * CR名だけでなく流入経路も確認
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

const SPREADSHEET_ID = '1WdvXZiGakoRFTGqZGCBAKlfZgjVP4xhBPE55oMVgsic';
const START_DATE = new Date(2025, 0, 1);
const END_DATE = new Date(2026, 0, 1);

function parseDate(dateString: string): Date | null {
  if (!dateString) return null;
  const match = dateString.trim().match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!match) return null;
  return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
}

async function main() {
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "'シート1'!A:H",
  });
  const rows = res.data.values || [];
  console.log(`全${rows.length}行\n`);

  // [0]面談予約日 [2]流入経路 [7]CR名
  // TikTok広告を流入経路またはCR名から探す

  // 1. 流入経路にTikTokが含まれるものの集計
  const inflowCounts: Record<string, number> = {};
  const crCounts: Record<string, number> = {};
  let tiktokTotal = 0;

  // スキルプラス関連を特に調査
  const spInflowCounts: Record<string, number> = {};
  const spCrSamples: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateValue = String(row[0] || '');
    const inflow = String(row[2] || '').trim();
    const crName = String(row[7] || '').trim();
    const rowDate = parseDate(dateValue);
    if (!rowDate || rowDate < START_DATE || rowDate >= END_DATE) continue;

    // TikTok広告の流入経路
    if (inflow.includes('TikTok')) {
      inflowCounts[inflow] = (inflowCounts[inflow] || 0) + 1;
      tiktokTotal++;
    }

    // TikTok広告のCR名
    if (crName.includes('TikTok')) {
      const crs = crName.split(',').map(s => s.trim()).filter(s => s.includes('TikTok'));
      for (const cr of crs) {
        crCounts[cr] = (crCounts[cr] || 0) + 1;
      }
    }

    // スキルプラス関連
    if (inflow.includes('スキルプラス') || crName.includes('スキルプラス')) {
      spInflowCounts[inflow] = (spInflowCounts[inflow] || 0) + 1;
      if (crName && spCrSamples.length < 20) {
        spCrSamples.push(`${inflow} → CR名: ${crName}`);
      }
    }
  }

  console.log('=== TikTok広告 流入経路別（2025年） ===');
  const sortedInflow = Object.entries(inflowCounts).sort((a, b) => b[1] - a[1]);
  for (const [path, count] of sortedInflow) {
    console.log(`  ${String(count).padStart(5)}件 | ${path}`);
  }
  console.log(`合計: ${tiktokTotal}件\n`);

  console.log('=== TikTok広告 CR名別 上位30（2025年） ===');
  const sortedCR = Object.entries(crCounts).sort((a, b) => b[1] - a[1]);
  for (const [cr, count] of sortedCR.slice(0, 30)) {
    console.log(`  ${String(count).padStart(5)}件 | ${cr}`);
  }
  console.log(`CR名にTikTok含む合計: ${Object.values(crCounts).reduce((s, v) => s + v, 0)}件\n`);

  console.log('=== スキルプラス関連の流入経路（2025年） ===');
  const sortedSP = Object.entries(spInflowCounts).sort((a, b) => b[1] - a[1]);
  for (const [path, count] of sortedSP) {
    console.log(`  ${String(count).padStart(5)}件 | ${path}`);
  }
  console.log(`\nスキルプラスのCR名サンプル:`);
  for (const s of spCrSamples) {
    console.log(`  ${s}`);
  }
}

main().catch(console.error);
