import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');

const DAILY_REPORT_SHEET_ID = '17PWEALugoIY2aKtjpITuyEAwJRz7o03q5iLeR5_5FwM';
const RESERVATION_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Check daily report for SNS2
  console.log('=== 日次レポートシートからSNS2のデータ ===\n');
  const reportRes = await sheets.spreadsheets.values.get({
    spreadsheetId: DAILY_REPORT_SHEET_ID,
    range: 'シート1!A:S'
  });
  const reportRows = reportRes.data.values || [];

  // Filter for SNS2 in the last 7 days
  const sns2Rows = reportRows.filter((row: any) => row[1] === 'SNS2' || row[1] === 'SNS_2');
  const dates = [...new Set(reportRows.slice(1).map((r: any) => r[0]))].sort().reverse().slice(0, 7);

  console.log(`SNS2の行数: ${sns2Rows.length}`);
  console.log(`直近日付: ${dates.slice(0, 5).join(', ')}`);

  // Show SNS2 data for recent dates
  for (const date of dates.slice(0, 3)) {
    const dayRows = reportRows.filter((r: any) => r[0] === date && (r[1] === 'SNS2' || r[1] === 'SNS_2'));
    if (dayRows.length > 0) {
      console.log(`\n[${date}] SNS2 (${dayRows.length}本):`);
      let daySpend = 0, dayCV = 0;
      for (const row of dayRows) {
        const adName = row[3] || '';
        const todayCPA = row[7] || '0';
        const todayCV = row[8] || '0';
        const todaySpend = row[9] || '0';
        const sevenDayCPA = row[10] || '0';
        const sevenDayCV = row[14] || '0';
        const action = row[5] || '';
        daySpend += parseFloat(String(todaySpend).replace(/[¥,]/g, '')) || 0;
        dayCV += parseInt(todayCV) || 0;
        console.log(`  ${adName.slice(0, 50)} | 当日CV=${todayCV}, 消化=${todaySpend} | 7日CV=${sevenDayCV}, CPA=${sevenDayCPA} | ${action}`);
      }
      console.log(`  日計: 消化=¥${daySpend.toFixed(0)}, CV=${dayCV}`);
    }
  }

  // 2. Check individual reservation sheet for SNS registrations in recent days
  console.log('\n\n=== 個別予約シート(SNSタブ)から直近7日 ===\n');
  const snsRes = await sheets.spreadsheets.values.get({
    spreadsheetId: RESERVATION_SHEET_ID,
    range: 'SNS!A:AZ'
  });
  const snsRows = snsRes.data.values || [];

  const now = new Date();
  const cutoff = new Date(now.getTime() - 7 * 86400000);
  let recentReservations = 0;

  for (let i = 1; i < snsRows.length; i++) {
    const row = snsRows[i];
    const dateStr = String(row[0] || '').trim();
    const slashMatch = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (!slashMatch) continue;

    const rowDate = new Date(parseInt(slashMatch[1]), parseInt(slashMatch[2]) - 1, parseInt(slashMatch[3]));
    if (rowDate < cutoff) continue;

    const pathValue = row[46]; // Column AU
    if (pathValue) {
      recentReservations++;
      console.log(`  ${dateStr} | ${String(pathValue).slice(0, 80)}`);
    }
  }

  console.log(`\n直近7日のSNS個別予約: ${recentReservations}件`);

  // 3. Also check the TT_オプト sheet if it exists
  console.log('\n\n=== TT_オプトシート確認 ===');
  try {
    const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: DAILY_REPORT_SHEET_ID });
    const sheetNames = sheetMeta.data.sheets?.map((s: any) => s.properties?.title) || [];
    console.log(`シート一覧: ${sheetNames.join(', ')}`);
  } catch (e) {
    console.log('シート一覧取得エラー');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
