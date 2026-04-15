/**
 * 再出稿候補4CRの成約確認
 * 個別予約スプレッドシートの全カラムを確認し、
 * 対象CRの個別予約者が成約に至っているか調査
 *
 * npx tsx apps/backend/check-candidate-sales.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

import { google } from 'googleapis';

const SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

const TARGET_CRS = ['LP1-CR00928', 'LP4-CR00003', 'LP2-CR00189', 'LP1-CR01144'];

function extractLpCr(text: string): string | null {
  const match = text.match(/(LP\d+-CR\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  console.log('=== 再出稿候補 成約確認 ===\n');

  // 1. AIシートのヘッダーを確認
  console.log('【AIシート ヘッダー確認】');
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'AI!1:1',
  });
  const headers = headerRes.data.values?.[0] || [];
  console.log('カラム一覧:');
  for (let i = 0; i < headers.length; i++) {
    const colLetter = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
    if (headers[i]) console.log(`  ${colLetter}列 (${i}): ${headers[i]}`);
  }

  // 2. 全データ取得してCR別に個別予約者の行を抽出
  console.log('\n【対象CRの個別予約データ】');
  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'AI!A:AZ',
  });
  const rows = dataRes.data.values || [];
  console.log(`全行数: ${rows.length}\n`);

  // 対象CRにマッチする行を抽出
  for (const targetCr of TARGET_CRS) {
    console.log(`--- ${targetCr} ---`);
    const matchedRows: any[][] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const pathCell = row[46] || ''; // AU列
      const lines = pathCell.split('\n');
      for (const line of lines) {
        const lpCr = extractLpCr(line.trim());
        if (lpCr === targetCr) {
          matchedRows.push(row);
          break;
        }
      }
    }

    console.log(`  個別予約数: ${matchedRows.length}件`);

    if (matchedRows.length > 0) {
      // 各行の主要情報を表示（ヘッダーを参照して意味のあるカラムを出す）
      for (const row of matchedRows) {
        const date = row[0] || '';
        // 成約に関連しそうなカラムを探す
        // 一般的に: 名前、メール、ステータス、成約日、売上等
        const info: string[] = [`日付: ${date}`];

        // ヘッダーから成約・ステータス関連を検索
        for (let i = 0; i < headers.length; i++) {
          const h = (headers[i] || '').toLowerCase();
          if (h.includes('成約') || h.includes('売上') || h.includes('着座') ||
              h.includes('ステータス') || h.includes('status') || h.includes('契約') ||
              h.includes('着金') || h.includes('入金') || h.includes('結果') ||
              h.includes('バック') || h.includes('name') || h.includes('名前') ||
              h.includes('面談')) {
            if (row[i]) info.push(`${headers[i]}: ${row[i]}`);
          }
        }

        console.log(`  ${info.join(' | ')}`);
      }
    }
    console.log('');
  }

  // 3. 成約カラムが見つかった場合、全体の成約率も確認
  console.log('\n【全体の個別予約→成約率（参考）】');

  // AB列(27)に成約関連データがあるか確認
  let totalIndRes = 0;
  let totalWithSales = 0;
  const salesColCandidates: number[] = [];

  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] || '').toLowerCase();
    if (h.includes('成約') || h.includes('契約') || h.includes('着金') || h.includes('バック')) {
      salesColCandidates.push(i);
    }
  }

  if (salesColCandidates.length > 0) {
    console.log(`成約関連カラム: ${salesColCandidates.map(i => `${headers[i]}(${i})`).join(', ')}`);

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const pathCell = row[46] || '';
      if (!pathCell.trim()) continue;
      totalIndRes++;

      for (const col of salesColCandidates) {
        if (row[col] && row[col].trim()) {
          totalWithSales++;
          break;
        }
      }
    }
    console.log(`個別予約総数: ${totalIndRes}件 | 成約データあり: ${totalWithSales}件 (${(totalWithSales / totalIndRes * 100).toFixed(1)}%)`);
  } else {
    console.log('成約関連カラムがスプレッドシートに見つかりません');
    console.log('→ CR単位の成約追跡は現状不可。チャネル全体の成約率（約18%）で推定するしかありません');
  }

  // 4. 推定成約数（全体成約率18%で計算）
  console.log('\n【推定成約数（AI導線全体の成約率18%で推定）】');
  for (const targetCr of TARGET_CRS) {
    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const pathCell = rows[i][46] || '';
      for (const line of pathCell.split('\n')) {
        if (extractLpCr(line.trim()) === targetCr) { count++; break; }
      }
    }
    const estimated = (count * 0.18).toFixed(1);
    console.log(`  ${targetCr}: 個別予約 ${count}件 → 推定成約 ${estimated}件`);
  }
}

main().catch(console.error);
