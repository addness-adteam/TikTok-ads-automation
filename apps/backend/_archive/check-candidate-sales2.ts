/**
 * 再出稿候補の成約確認（AV列「売り上げたCR」から）
 *
 * npx tsx apps/backend/check-candidate-sales2.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

import { google } from 'googleapis';

const SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';
const TARGET_CRS = ['CR00928', 'CR00003', 'CR00189', 'CR01144'];

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'AI!A:AW',
  });
  const rows = res.data.values || [];

  console.log('=== 成約CR確認（AV列「売り上げたCR」）===\n');

  // AU列(46): 個別予約CR、AV列(47): 売り上げたCR、AB列(27): 成約数、AF列(31): バックエンド売上
  // まず全成約CRを収集
  const salesByCr = new Map<string, { dates: string[]; count: number }>();
  const indResByCr = new Map<string, { dates: string[]; count: number }>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const date = row[0] || '';
    const indResCell = row[46] || ''; // AU列: 個別予約CR
    const salesCell = row[47] || '';  // AV列: 売り上げたCR
    const salesCount = parseInt(row[27] || '0'); // AB列: 成約数
    const backendSales = row[31] || ''; // AF列: バックエンド売上

    // 個別予約CRを記録
    for (const line of indResCell.split('\n')) {
      const crMatch = line.trim().match(/(CR\d+)/i);
      if (crMatch) {
        const cr = crMatch[1].toUpperCase();
        if (!indResByCr.has(cr)) indResByCr.set(cr, { dates: [], count: 0 });
        indResByCr.get(cr)!.dates.push(date);
        indResByCr.get(cr)!.count++;
      }
    }

    // 売り上げたCRを記録
    for (const line of salesCell.split('\n')) {
      const crMatch = line.trim().match(/(CR\d+)/i);
      if (crMatch) {
        const cr = crMatch[1].toUpperCase();
        if (!salesByCr.has(cr)) salesByCr.set(cr, { dates: [], count: 0 });
        salesByCr.get(cr)!.dates.push(date);
        salesByCr.get(cr)!.count++;
      }
    }
  }

  // 対象CRの成約状況
  console.log('【対象4CR】\n');
  for (const cr of TARGET_CRS) {
    const indRes = indResByCr.get(cr);
    const sales = salesByCr.get(cr);
    console.log(`${cr}:`);
    console.log(`  個別予約: ${indRes ? `${indRes.count}件 (${indRes.dates.join(', ')})` : '0件'}`);
    console.log(`  成約:     ${sales ? `${sales.count}件 (${sales.dates.join(', ')})` : '0件'}`);
    if (indRes && indRes.count > 0) {
      const rate = sales ? (sales.count / indRes.count * 100).toFixed(0) : '0';
      console.log(`  成約率:   ${rate}%`);
    }
    console.log('');
  }

  // 全CRの成約状況（参考）
  console.log('\n【全CR 成約実績あり一覧（参考）】\n');
  const allSalesCrs = [...salesByCr.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [cr, data] of allSalesCrs) {
    const indRes = indResByCr.get(cr);
    const indResCount = indRes?.count || 0;
    const rate = indResCount > 0 ? (data.count / indResCount * 100).toFixed(0) : '-';
    console.log(`  ${cr}: 成約${data.count}件 / 個別予約${indResCount}件 (${rate}%) | ${data.dates.join(', ')}`);
  }

  // 成約ゼロだが個別予約が多いCR（要注意）
  console.log('\n\n【個別予約あり＋成約ゼロのCR（要注意）】\n');
  const noSalesCrs = [...indResByCr.entries()]
    .filter(([cr]) => !salesByCr.has(cr))
    .sort((a, b) => b[1].count - a[1].count);
  for (const [cr, data] of noSalesCrs.slice(0, 15)) {
    console.log(`  ${cr}: 個別予約${data.count}件 → 成約0件 | ${data.dates.join(', ')}`);
  }
}

main().catch(console.error);
