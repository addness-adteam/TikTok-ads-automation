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
  // Check AI opt-in - look at ALL columns carefully
  const aiOptinSheetId = '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk';

  console.log('=== AI Opt-in: Full row analysis ===');
  const aiOptin = await sheets.spreadsheets.values.get({
    spreadsheetId: aiOptinSheetId,
    range: 'TT_オプト!A1:Z10',
  });
  const aiRows = aiOptin.data.values || [];
  for (let i = 0; i < Math.min(aiRows.length, 5); i++) {
    console.log(`Row ${i} (${aiRows[i].length} cols):`);
    aiRows[i].forEach((val: string, j: number) => {
      const display = val.length > 80 ? val.substring(0, 80) + '...' : val;
      console.log(`  [${j}] ${display}`);
    });
  }

  // Find which column has CR patterns
  console.log('\n=== AI Opt-in: Finding CR/registration path column ===');
  const aiAll = await sheets.spreadsheets.values.get({
    spreadsheetId: aiOptinSheetId,
    range: 'TT_オプト!A1:Z100',
  });
  const allAiRows = aiAll.data.values || [];
  // For each column, check if any values contain "CR" followed by digits
  const colCounts: { [col: number]: number } = {};
  for (let i = 1; i < allAiRows.length; i++) {
    for (let j = 0; j < allAiRows[i].length; j++) {
      const val = allAiRows[i][j] || '';
      if (/CR\d+/.test(val)) {
        colCounts[j] = (colCounts[j] || 0) + 1;
      }
    }
  }
  console.log('Columns containing CR+digits pattern:');
  Object.entries(colCounts).forEach(([col, count]) => {
    console.log(`  Column ${col}: ${count} matches (header: ${allAiRows[0]?.[parseInt(col)] || 'N/A'})`);
  });

  // Check email column
  const emailColCounts: { [col: number]: number } = {};
  for (let i = 1; i < allAiRows.length; i++) {
    for (let j = 0; j < allAiRows[i].length; j++) {
      const val = allAiRows[i][j] || '';
      if (val.includes('@') && val.includes('.')) {
        emailColCounts[j] = (emailColCounts[j] || 0) + 1;
      }
    }
  }
  console.log('\nColumns containing email-like values:');
  Object.entries(emailColCounts).forEach(([col, count]) => {
    console.log(`  Column ${col}: ${count} matches (header: ${allAiRows[0]?.[parseInt(col)] || 'N/A'})`);
  });

  // Do the same for SNS
  const snsOptinSheetId = '1JlEC8rQAM3h2E7GuUplMPrLyVdA5Q3nZ0lGneC2nZvY';
  console.log('\n=== SNS Opt-in: Full row analysis ===');
  const snsOptin = await sheets.spreadsheets.values.get({
    spreadsheetId: snsOptinSheetId,
    range: 'TT_オプト!A1:Z10',
  });
  const snsRows = snsOptin.data.values || [];
  for (let i = 0; i < Math.min(snsRows.length, 5); i++) {
    console.log(`Row ${i} (${snsRows[i].length} cols):`);
    snsRows[i].forEach((val: string, j: number) => {
      const display = val.length > 80 ? val.substring(0, 80) + '...' : val;
      console.log(`  [${j}] ${display}`);
    });
  }

  // SNS column analysis
  const snsAll = await sheets.spreadsheets.values.get({
    spreadsheetId: snsOptinSheetId,
    range: 'TT_オプト!A1:Z100',
  });
  const allSnsRows = snsAll.data.values || [];
  const snsColCounts: { [col: number]: number } = {};
  for (let i = 1; i < allSnsRows.length; i++) {
    for (let j = 0; j < allSnsRows[i].length; j++) {
      const val = allSnsRows[i][j] || '';
      if (/CR\d+/.test(val)) {
        snsColCounts[j] = (snsColCounts[j] || 0) + 1;
      }
    }
  }
  console.log('\nSNS Columns containing CR+digits:');
  Object.entries(snsColCounts).forEach(([col, count]) => {
    console.log(`  Column ${col}: ${count} matches (header: ${allSnsRows[0]?.[parseInt(col)] || 'N/A'})`);
  });

  const snsEmailColCounts: { [col: number]: number } = {};
  for (let i = 1; i < allSnsRows.length; i++) {
    for (let j = 0; j < allSnsRows[i].length; j++) {
      const val = allSnsRows[i][j] || '';
      if (val.includes('@') && val.includes('.')) {
        snsEmailColCounts[j] = (snsEmailColCounts[j] || 0) + 1;
      }
    }
  }
  console.log('\nSNS Columns containing email-like values:');
  Object.entries(snsEmailColCounts).forEach(([col, count]) => {
    console.log(`  Column ${col}: ${count} matches (header: ${allSnsRows[0]?.[parseInt(col)] || 'N/A'})`);
  });

  // Show some sample registration paths with CR numbers
  console.log('\n=== Sample AI registration paths with CR numbers ===');
  let count = 0;
  for (let i = 1; i < allAiRows.length && count < 10; i++) {
    for (let j = 0; j < allAiRows[i].length; j++) {
      const val = allAiRows[i][j] || '';
      if (/CR\d+/.test(val) && !val.startsWith('http')) {
        console.log(`  Row ${i}, Col ${j}: ${val.substring(0, 120)}`);
        count++;
        break;
      }
    }
  }

  console.log('\n=== Sample SNS registration paths with CR numbers ===');
  count = 0;
  for (let i = 1; i < allSnsRows.length && count < 10; i++) {
    for (let j = 0; j < allSnsRows[i].length; j++) {
      const val = allSnsRows[i][j] || '';
      if (/CR\d+/.test(val) && !val.startsWith('http')) {
        console.log(`  Row ${i}, Col ${j}: ${val.substring(0, 120)}`);
        count++;
        break;
      }
    }
  }
}

main().catch(console.error);
