import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const spreadsheetId = '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk';
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'TT_オプト',
  });

  const rows = response.data.values;
  if (!rows) return;

  // ヘッダーから列位置を特定
  const header = rows[0];
  let pathColIndex = -1;
  let dateColIndex = -1;
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i]).trim();
    if (h.includes('経路')) pathColIndex = i;
    if (h.includes('日時')) dateColIndex = i;
  }

  // CRごとに4/9のCV時刻を集計
  const crTimings = new Map<string, string[]>();
  const targetCRs = ['CR01190', 'CR01144', 'CR01169', 'CR01163', 'CR01150'];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateValue = String(row[dateColIndex] || '');
    const pathValue = String(row[pathColIndex] || '');

    if (!dateValue.includes('2026-04-09') && !dateValue.includes('2026/04/09')) continue;
    if (!pathValue.includes('TikTok広告-AI')) continue;

    for (const cr of targetCRs) {
      if (pathValue.includes(cr)) {
        const list = crTimings.get(cr) || [];
        list.push(dateValue);
        crTimings.set(cr, list);
      }
    }
  }

  for (const cr of targetCRs) {
    const times = crTimings.get(cr) || [];
    times.sort();
    console.log(`\n=== ${cr}: ${times.length}件 ===`);
    if (times.length > 0) {
      console.log(`  最初のCV: ${times[0]}`);
      console.log(`  最後のCV: ${times[times.length - 1]}`);
      // 時間帯別
      const hourCounts = new Map<string, number>();
      for (const t of times) {
        // 時刻部分を抽出
        const match = t.match(/(\d{1,2}):(\d{2})/);
        if (match) {
          const hour = match[1].padStart(2, '0');
          hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
        }
      }
      console.log('  時間帯別:');
      for (const [h, c] of [...hourCounts.entries()].sort()) {
        console.log(`    ${h}時台: ${c}件`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
