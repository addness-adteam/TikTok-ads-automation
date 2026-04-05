import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

async function main() {
  // 1. Target sheet
  const targetSheetId = '1h--o9lmiCoBRM-lyB998n1H1Lep795T-NupK2ifo0eA';

  console.log('=== Target Sheet: マスターデータ_AI ===');
  try {
    const aiData = await sheets.spreadsheets.values.get({
      spreadsheetId: targetSheetId,
      range: 'マスターデータ_AI!A1:J5',
    });
    console.log('Headers + first rows:');
    (aiData.data.values || []).forEach((row, i) => console.log(`  Row ${i}: ${JSON.stringify(row)}`));
  } catch (e: any) {
    console.log('Error:', e.message);
  }

  console.log('\n=== Target Sheet: マスターデータ_SNS ===');
  try {
    const snsData = await sheets.spreadsheets.values.get({
      spreadsheetId: targetSheetId,
      range: 'マスターデータ_SNS!A1:J5',
    });
    console.log('Headers + first rows:');
    (snsData.data.values || []).forEach((row, i) => console.log(`  Row ${i}: ${JSON.stringify(row)}`));
  } catch (e: any) {
    console.log('Error:', e.message);
  }

  // 2. AI Opt-in sheet (TT_オプト)
  const aiOptinSheetId = '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk';
  console.log('\n=== AI Opt-in Sheet (TT_オプト) ===');
  try {
    const aiOptin = await sheets.spreadsheets.values.get({
      spreadsheetId: aiOptinSheetId,
      range: 'TT_オプト!A1:Z3',
    });
    console.log('Headers + first rows:');
    (aiOptin.data.values || []).forEach((row, i) => console.log(`  Row ${i}: ${JSON.stringify(row)}`));
  } catch (e: any) {
    console.log('Error:', e.message);
  }

  // 3. SNS Opt-in sheet (TT_オプト)
  const snsOptinSheetId = '1JlEC8rQAM3h2E7GuUplMPrLyVdA5Q3nZ0lGneC2nZvY';
  console.log('\n=== SNS Opt-in Sheet (TT_オプト) ===');
  try {
    const snsOptin = await sheets.spreadsheets.values.get({
      spreadsheetId: snsOptinSheetId,
      range: 'TT_オプト!A1:Z3',
    });
    console.log('Headers + first rows:');
    (snsOptin.data.values || []).forEach((row, i) => console.log(`  Row ${i}: ${JSON.stringify(row)}`));
  } catch (e: any) {
    console.log('Error:', e.message);
  }

  // Also check how many rows in target sheets
  console.log('\n=== Target Sheet Row Counts ===');
  try {
    const aiAll = await sheets.spreadsheets.values.get({
      spreadsheetId: targetSheetId,
      range: 'マスターデータ_AI!E:G',
    });
    const aiRows = aiAll.data.values || [];
    console.log(`マスターデータ_AI: ${aiRows.length} rows total`);
    // Show rows where F is empty but E has email
    let emptyF = 0;
    for (let i = 1; i < aiRows.length; i++) {
      const email = aiRows[i]?.[0];
      const adName = aiRows[i]?.[1];
      if (email && !adName) emptyF++;
    }
    console.log(`  Rows with email but no ad name: ${emptyF}`);
  } catch (e: any) {
    console.log('Error:', e.message);
  }

  try {
    const snsAll = await sheets.spreadsheets.values.get({
      spreadsheetId: targetSheetId,
      range: 'マスターデータ_SNS!E:G',
    });
    const snsRows = snsAll.data.values || [];
    console.log(`マスターデータ_SNS: ${snsRows.length} rows total`);
    let emptyF = 0;
    for (let i = 1; i < snsRows.length; i++) {
      const email = snsRows[i]?.[0];
      const adName = snsRows[i]?.[1];
      if (email && !adName) emptyF++;
    }
    console.log(`  Rows with email but no ad name: ${emptyF}`);
  } catch (e: any) {
    console.log('Error:', e.message);
  }
}

main().catch(console.error);
