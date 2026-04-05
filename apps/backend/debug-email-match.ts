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

const TARGET_SHEET_ID = '1h--o9lmiCoBRM-lyB998n1H1Lep795T-NupK2ifo0eA';
const AI_OPTIN_SHEET_ID = '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk';
const SNS_OPTIN_SHEET_ID = '1JlEC8rQAM3h2E7GuUplMPrLyVdA5Q3nZ0lGneC2nZvY';

async function main() {
  // 1. Get target emails (AI)
  const targetAI = await sheets.spreadsheets.values.get({
    spreadsheetId: TARGET_SHEET_ID,
    range: "'マスターデータ_AI'!E:F",
  });
  const targetAIRows = targetAI.data.values || [];
  const targetEmails = new Set<string>();
  for (let i = 1; i < targetAIRows.length; i++) {
    const email = (targetAIRows[i]?.[0] || '').trim().toLowerCase();
    const adName = (targetAIRows[i]?.[1] || '').trim();
    if (email && email.includes('@') && !adName) {
      targetEmails.add(email);
    }
  }
  console.log(`Target AI emails (F empty): ${targetEmails.size}`);
  // Show first 5
  const first5 = [...targetEmails].slice(0, 5);
  first5.forEach(e => console.log(`  ${e}`));

  // 2. Get ALL opt-in emails (AI) - without TT filter
  const aiOptin = await sheets.spreadsheets.values.get({
    spreadsheetId: AI_OPTIN_SHEET_ID,
    range: 'TT_オプト!A:F',
  });
  const aiRows = aiOptin.data.values || [];
  console.log(`\nAI opt-in total rows: ${aiRows.length}`);

  // Build ALL email mappings (no TT filter)
  const allEmails = new Map<string, string>();
  const ttEmails = new Map<string, string>();
  for (let i = 1; i < aiRows.length; i++) {
    const row = aiRows[i];
    // Check all possible email columns
    let email = '';
    for (let j = 0; j < Math.min(row.length, 3); j++) {
      const val = (row[j] || '').trim().toLowerCase();
      if (val.includes('@') && val.includes('.')) {
        email = val;
        break;
      }
    }
    const regPath = (row[3] || '').trim(); // index 3 for AI
    if (!email || !regPath) continue;

    if (!allEmails.has(email)) {
      allEmails.set(email, regPath);
    }
    if (regPath.includes('TT') && !ttEmails.has(email)) {
      ttEmails.set(email, regPath);
    }
  }
  console.log(`All opt-in emails: ${allEmails.size}`);
  console.log(`TT opt-in emails: ${ttEmails.size}`);

  // 3. Check overlap
  let matchAll = 0;
  let matchTT = 0;
  for (const email of targetEmails) {
    if (allEmails.has(email)) matchAll++;
    if (ttEmails.has(email)) matchTT++;
  }
  console.log(`\nTarget emails matching in ALL opt-in: ${matchAll}`);
  console.log(`Target emails matching in TT opt-in: ${matchTT}`);

  // Show some non-matching target emails and their date range
  const targetFull = await sheets.spreadsheets.values.get({
    spreadsheetId: TARGET_SHEET_ID,
    range: "'マスターデータ_AI'!E:H",
  });
  const targetFullRows = targetFull.data.values || [];
  console.log('\nSample non-matching emails with dates:');
  let shown = 0;
  for (let i = 1; i < targetFullRows.length && shown < 10; i++) {
    const email = (targetFullRows[i]?.[0] || '').trim().toLowerCase();
    const adName = (targetFullRows[i]?.[1] || '').trim();
    const date = (targetFullRows[i]?.[3] || '').trim(); // H列 = 友だち追加日時
    if (email && email.includes('@') && !adName && !allEmails.has(email)) {
      console.log(`  ${email} (date: ${date})`);
      shown++;
    }
  }

  // Show the date range of opt-in data
  console.log('\nOpt-in date range:');
  const dates = aiRows.slice(1).map(r => r[4] || r[5] || '').filter(Boolean);
  if (dates.length > 0) {
    console.log(`  First: ${dates[0]}`);
    console.log(`  Last: ${dates[dates.length - 1]}`);
  }

  // Check what kinds of registration paths exist (not just TT)
  console.log('\nRegistration path patterns (sample of non-TT):');
  const nonTTPaths = new Set<string>();
  for (let i = 1; i < aiRows.length; i++) {
    const path = (aiRows[i]?.[3] || '').trim();
    if (path && !path.includes('TT')) {
      nonTTPaths.add(path);
    }
  }
  console.log(`  Non-TT unique paths: ${nonTTPaths.size}`);
  [...nonTTPaths].slice(0, 10).forEach(p => console.log(`    ${p.substring(0, 100)}`));

  // Check if target emails are in the opt-in but without TT
  console.log('\nTarget emails found in opt-in with non-TT paths:');
  shown = 0;
  for (const email of targetEmails) {
    if (allEmails.has(email) && !ttEmails.has(email)) {
      console.log(`  ${email} → ${allEmails.get(email)?.substring(0, 80)}`);
      shown++;
      if (shown >= 5) break;
    }
  }

  // Also check: are target sheet dates newer than opt-in dates?
  console.log('\n=== Date range analysis ===');
  const targetDates = targetFullRows.slice(1)
    .map(r => (r[3] || '').trim())
    .filter(Boolean)
    .sort();
  if (targetDates.length > 0) {
    console.log(`Target date range: ${targetDates[0]} ~ ${targetDates[targetDates.length - 1]}`);
  }

  // Check SNS as well
  console.log('\n=== SNS Analysis ===');
  const targetSNS = await sheets.spreadsheets.values.get({
    spreadsheetId: TARGET_SHEET_ID,
    range: "'マスターデータ_SNS'!E:H",
  });
  const targetSNSRows = targetSNS.data.values || [];
  const targetSNSEmails = new Set<string>();
  for (let i = 1; i < targetSNSRows.length; i++) {
    const email = (targetSNSRows[i]?.[0] || '').trim().toLowerCase();
    const adName = (targetSNSRows[i]?.[1] || '').trim();
    if (email && email.includes('@') && !adName) {
      targetSNSEmails.add(email);
    }
  }
  console.log(`Target SNS emails (F empty): ${targetSNSEmails.size}`);

  const snsOptin = await sheets.spreadsheets.values.get({
    spreadsheetId: SNS_OPTIN_SHEET_ID,
    range: 'TT_オプト!A:F',
  });
  const snsRows = snsOptin.data.values || [];
  const snsAllEmails = new Map<string, string>();
  const snsTTEmails = new Map<string, string>();
  for (let i = 1; i < snsRows.length; i++) {
    const row = snsRows[i];
    let email = '';
    for (let j = 0; j < Math.min(row.length, 3); j++) {
      const val = (row[j] || '').trim().toLowerCase();
      if (val.includes('@') && val.includes('.')) {
        email = val;
        break;
      }
    }
    const regPath = (row[4] || '').trim(); // index 4 for SNS
    if (!email || !regPath) continue;
    if (!snsAllEmails.has(email)) snsAllEmails.set(email, regPath);
    if (regPath.includes('TT') && !snsTTEmails.has(email)) snsTTEmails.set(email, regPath);
  }
  console.log(`SNS opt-in all emails: ${snsAllEmails.size}, TT emails: ${snsTTEmails.size}`);

  let snsMatchAll = 0;
  let snsMatchTT = 0;
  for (const email of targetSNSEmails) {
    if (snsAllEmails.has(email)) snsMatchAll++;
    if (snsTTEmails.has(email)) snsMatchTT++;
  }
  console.log(`SNS target matching ALL: ${snsMatchAll}, matching TT: ${snsMatchTT}`);

  // Show non-TT paths for SNS target matches
  console.log('\nSNS target emails found with non-TT paths:');
  shown = 0;
  for (const email of targetSNSEmails) {
    if (snsAllEmails.has(email) && !snsTTEmails.has(email)) {
      console.log(`  ${email} → ${snsAllEmails.get(email)?.substring(0, 80)}`);
      shown++;
      if (shown >= 5) break;
    }
  }
}

main().catch(console.error);
