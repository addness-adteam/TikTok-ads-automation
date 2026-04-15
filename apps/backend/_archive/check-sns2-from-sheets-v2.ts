import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');

const DAILY_REPORT_SHEET_ID = '17PWEALugoIY2aKtjpITuyEAwJRz7o03q5iLeR5_5FwM';
const RESERVATION_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

// SNS2 advertiser ID for cross-reference
const SNS2_ADVERTISER_ID = '7543540100849156112';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Check daily report for all SNS rows
  console.log('=== 日次レポートシートからSNS全体のデータ（直近3日） ===\n');
  const reportRes = await sheets.spreadsheets.values.get({
    spreadsheetId: DAILY_REPORT_SHEET_ID,
    range: 'シート1!A:S'
  });
  const reportRows = reportRes.data.values || [];
  const headers = reportRows[0];
  console.log('ヘッダー:', headers.join(' | '));

  const snsRows = reportRows.filter((row: any) => row[1] === 'SNS');
  const dates = [...new Set(reportRows.slice(1).map((r: any) => r[0]))].sort().reverse();

  console.log(`\nSNS行の総数: ${snsRows.length}`);
  console.log(`直近日付: ${dates.slice(0, 5).join(', ')}`);

  // Show SNS data for recent 3 days
  for (const date of dates.slice(0, 3)) {
    const dayRows = reportRows.filter((r: any) => r[0] === date && r[1] === 'SNS');
    if (dayRows.length > 0) {
      console.log(`\n[${date}] SNS (${dayRows.length}本):`);
      let daySpend = 0, dayCV = 0;
      for (const row of dayRows) {
        const pipeline = row[2] || '';
        const adName = row[3] || '';
        const budget = row[4] || '';
        const action = row[5] || '';
        const newBudget = row[6] || '';
        const todayCPA = row[7] || '';
        const todayCV = row[8] || '0';
        const todaySpend = row[9] || '0';
        const sevenDayCPA = row[10] || '';
        const sevenDayFrontCPO = row[11] || '';
        const sevenDayResCPO = row[12] || '';
        const sevenDaySpend = row[13] || '0';
        const sevenDayCV = row[14] || '0';
        const sevenDayFrontSales = row[15] || '0';
        const sevenDayRes = row[16] || '0';
        const pauseJudge = row[17] || '';
        const reason = row[18] || '';

        const spend = parseFloat(String(todaySpend).replace(/[¥,]/g, '')) || 0;
        const cv = parseInt(todayCV) || 0;
        daySpend += spend;
        dayCV += cv;

        console.log(`  導線=${pipeline} | ${adName.slice(0, 45)} | 予算=${budget} | ${action} → ${newBudget}`);
        console.log(`    当日: CPA=${todayCPA}, CV=${todayCV}, 消化=${todaySpend}`);
        console.log(`    7日: CPA=${sevenDayCPA}, CV=${sevenDayCV}, 消化=${sevenDaySpend}, フロントCPO=${sevenDayFrontCPO}, 予約CPO=${sevenDayResCPO}, フロント販売=${sevenDayFrontSales}, 予約=${sevenDayRes}`);
        console.log(`    判定: ${pauseJudge} | ${reason.slice(0, 80)}`);
      }
      console.log(`  === 日計: 消化=¥${daySpend.toFixed(0)}, CV=${dayCV} ===`);
    }
  }

  // 2. Check individual reservation sheet for SNS
  console.log('\n\n=== 個別予約シート(SNSタブ)の構造確認 ===\n');
  const snsRes = await sheets.spreadsheets.values.get({
    spreadsheetId: RESERVATION_SHEET_ID,
    range: 'SNS!A1:AZ1'
  });
  const snsHeaders = snsRes.data.values?.[0] || [];
  console.log('SNSタブのヘッダー:');
  for (let i = 0; i < snsHeaders.length; i++) {
    if (snsHeaders[i]) console.log(`  Col ${i} (${String.fromCharCode(65 + (i < 26 ? i : -1))}${i >= 26 ? String.fromCharCode(65 + i - 26) : ''}): ${snsHeaders[i]}`);
  }

  // Get recent SNS reservation data
  console.log('\n=== 個別予約シート(SNSタブ)直近データ ===\n');
  const snsDataRes = await sheets.spreadsheets.values.get({
    spreadsheetId: RESERVATION_SHEET_ID,
    range: 'SNS!A:AZ'
  });
  const snsDataRows = snsDataRes.data.values || [];

  const now = new Date();
  const cutoff = new Date(now.getTime() - 14 * 86400000); // 14 days
  let recentCount = 0;

  for (let i = snsDataRows.length - 1; i >= 1 && recentCount < 30; i--) {
    const row = snsDataRows[i];
    const dateStr = String(row[0] || '').trim();
    if (!dateStr) continue;

    const slashMatch = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (!slashMatch) continue;

    const rowDate = new Date(parseInt(slashMatch[1]), parseInt(slashMatch[2]) - 1, parseInt(slashMatch[3]));
    if (rowDate < cutoff) break;

    recentCount++;
    // Show key columns: date, and any path/source info
    const cols = row.slice(0, 10).map((c: any) => String(c || '').slice(0, 30));
    console.log(`  Row ${i}: ${cols.join(' | ')}`);
  }
  console.log(`表示行数: ${recentCount}`);

  // 3. Check sheet tabs in reservation sheet
  console.log('\n\n=== 個別予約シートのタブ一覧 ===');
  const resMeta = await sheets.spreadsheets.get({ spreadsheetId: RESERVATION_SHEET_ID });
  const resSheetNames = resMeta.data.sheets?.map((s: any) => s.properties?.title) || [];
  console.log(`タブ: ${resSheetNames.join(', ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
