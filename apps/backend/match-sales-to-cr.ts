/**
 * 成約者メールアドレス → オプトインのCR突合
 * 決済CSVのメール → TT_オプトシートのメール → 登録経路(CR) を特定
 *
 * npx tsx apps/backend/match-sales-to-cr.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.join(__dirname, '.env') });

import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function extractSpreadsheetId(url: string): string {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : url;
}

async function getSheetData(auth: any, spreadsheetId: string, sheetName: string, range: string): Promise<any[][]> {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${range}`,
  });
  return res.data.values || [];
}

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  console.log('=== 成約者 → CR突合 ===\n');

  // 1. 決済CSVからバックエンド成約者のメールを取得（SPスタンダード/SPプライム = 高額商品）
  const csvPath = 'c:/Users/itali/Downloads/決済履歴集計表_商品購入集計表_表.csv';
  const csvData = fs.readFileSync(csvPath, 'utf-8');
  const csvLines = csvData.split('\n').filter(l => l.trim());

  interface SalesRecord {
    date: string; product: string; name: string; email: string; amount: number;
  }

  const allSales: SalesRecord[] = [];
  const backendSales: SalesRecord[] = [];

  for (let i = 1; i < csvLines.length; i++) {
    // CSVパース（カンマ区切り、括弧内のカンマに注意）
    const parts: string[] = [];
    let current = '';
    let inParens = false;
    for (const ch of csvLines[i]) {
      if (ch === '(' || ch === '（') inParens = true;
      if (ch === ')' || ch === '）') inParens = false;
      if (ch === ',' && !inParens) {
        parts.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    parts.push(current.trim());

    const record: SalesRecord = {
      date: parts[0] || '',
      product: parts[4] || '',
      name: parts[5] || '',
      email: (parts[6] || '').toLowerCase().trim(),
      amount: parseInt(parts[8] || '0'),
    };

    if (!record.email) continue;
    allSales.push(record);

    // バックエンド商品（高額）を判定
    if (record.product.includes('SPスタンダード') || record.product.includes('SPプライム') ||
        record.product.includes('スキルプラス') || record.amount >= 100000) {
      backendSales.push(record);
    }
  }

  console.log(`決済CSV: 全${allSales.length}件, バックエンド(10万以上): ${backendSales.length}件\n`);

  // 2. AI導線のTT_オプトスプレッドシートからメール＋登録経路を取得
  const appeal = await prisma.appeal.findFirst({ where: { name: 'AI' } });
  if (!appeal?.cvSpreadsheetUrl) {
    console.log('AI導線のcvSpreadsheetUrlが見つかりません');
    await prisma.$disconnect();
    return;
  }

  const spreadsheetId = extractSpreadsheetId(appeal.cvSpreadsheetUrl);
  console.log(`オプトインシート: ${spreadsheetId}`);

  const rows = await getSheetData(auth, spreadsheetId, 'TT_オプト', 'A:Z');
  console.log(`TT_オプト: ${rows.length}行\n`);

  // ヘッダーからカラム特定
  const header = rows[0] || [];
  let emailCol = -1, pathCol = -1, dateCol = -1;

  console.log('ヘッダー:');
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] || '').trim();
    console.log(`  ${i}: ${h}`);
    if (h.includes('メール') || h.includes('email') || h.includes('Email') || h.includes('mail')) emailCol = i;
    if (['登録経路', '流入経路', 'ファネル登録経路', 'registration_path'].includes(h)) pathCol = i;
    if (['登録日時', '登録日', 'アクション実行日時', '実行日時', 'date'].includes(h)) dateCol = i;
  }

  // メールカラムが見つからない場合、データをスキャンしてメールっぽいカラムを探す
  if (emailCol === -1) {
    console.log('\nメールカラムがヘッダーで見つからない。データからメール列を推定...');
    const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const colEmailCounts = new Map<number, number>();

    for (let i = 1; i < Math.min(rows.length, 50); i++) {
      const row = rows[i];
      for (let j = 0; j < (row?.length || 0); j++) {
        if (row[j] && emailPattern.test(String(row[j]).trim())) {
          colEmailCounts.set(j, (colEmailCounts.get(j) || 0) + 1);
        }
      }
    }

    if (colEmailCounts.size > 0) {
      const best = [...colEmailCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      emailCol = best[0];
      console.log(`  → ${emailCol}列にメールアドレス${best[1]}件検出`);
    }
  }

  console.log(`\nカラム: メール=${emailCol}, 登録経路=${pathCol}, 日付=${dateCol}`);

  if (emailCol === -1) {
    console.log('\n⚠ メールアドレスのカラムが見つかりません。');
    console.log('  TT_オプトシートにメールアドレス列があるか確認してください。');
    console.log('\n代替案: オプト日時と成約日時の近さ＋名前一致で推定突合を試みます...\n');

    // 名前ベースの突合を試行
    matchByNameAndDate(backendSales, rows, pathCol, dateCol);
    await prisma.$disconnect();
    return;
  }

  // 3. メールアドレスで突合
  console.log('\n=== メールアドレス突合 ===\n');

  // オプトインのメール→CR マップを構築
  const emailToCr = new Map<string, { path: string; date: string; cr: string }[]>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const email = String(row[emailCol] || '').toLowerCase().trim();
    const regPath = String(row[pathCol] || '').trim();
    const date = String(row[dateCol] || '').trim();
    if (!email || !regPath.startsWith('TikTok広告-')) continue;

    const crMatch = regPath.match(/(LP\d+-CR\d+)/i);
    const cr = crMatch ? crMatch[1].toUpperCase() : '';

    if (!emailToCr.has(email)) emailToCr.set(email, []);
    emailToCr.get(email)!.push({ path: regPath, date, cr });
  }

  console.log(`オプトインのメール数: ${emailToCr.size}件\n`);

  // 突合実行
  let matched = 0;
  const crSalesCount = new Map<string, { count: number; totalAmount: number; names: string[] }>();

  for (const sale of backendSales) {
    const optinRecords = emailToCr.get(sale.email);
    if (optinRecords) {
      matched++;
      for (const optin of optinRecords) {
        if (!optin.cr) continue;
        if (!crSalesCount.has(optin.cr)) crSalesCount.set(optin.cr, { count: 0, totalAmount: 0, names: [] });
        const entry = crSalesCount.get(optin.cr)!;
        entry.count++;
        entry.totalAmount += sale.amount;
        entry.names.push(`${sale.name}(${sale.date})`);
      }
      console.log(`  ✓ ${sale.name} (${sale.email}) → ${optinRecords.map(o => o.cr).join(', ')} | ${sale.product} ¥${sale.amount.toLocaleString()}`);
    } else {
      console.log(`  ✗ ${sale.name} (${sale.email}) → オプトイン経路不明 | ${sale.product} ¥${sale.amount.toLocaleString()}`);
    }
  }

  console.log(`\n突合結果: ${matched}/${backendSales.length}件マッチ\n`);

  // CR別成約サマリー
  console.log('=== CR別 成約サマリー ===\n');
  const sorted = [...crSalesCount.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [cr, data] of sorted) {
    console.log(`${cr}: 成約${data.count}件 | 売上 ¥${data.totalAmount.toLocaleString()} | ${data.names.join(', ')}`);
  }

  // 対象4CRの結果
  console.log('\n\n=== 対象4CR 成約確認 ===\n');
  const targetCrs = ['LP1-CR00928', 'LP4-CR00003', 'LP2-CR00189', 'LP1-CR01144'];
  for (const cr of targetCrs) {
    const data = crSalesCount.get(cr);
    if (data) {
      console.log(`✓ ${cr}: 成約${data.count}件 | 売上 ¥${data.totalAmount.toLocaleString()}`);
    } else {
      console.log(`  ${cr}: 成約0件`);
    }
  }

  await prisma.$disconnect();
}

function matchByNameAndDate(sales: any[], rows: any[][], pathCol: number, dateCol: number) {
  // フォールバック: TT_オプトにメールがない場合の参考情報
  console.log('TT_オプトシートにメールアドレス列がないため、直接突合不可。\n');
  console.log('成約者のCR特定には以下のいずれかが必要:');
  console.log('  1. TT_オプトシートにメールアドレス列を追加する');
  console.log('  2. UTAGEの顧客データからメール→登録経路のマッピングを取得する');
  console.log('  3. 別のオプトイン管理シート（メールアドレス＋CR経路が両方あるもの）を使う');

  console.log('\n\nバックエンド成約者一覧（参考）:');
  for (const sale of sales) {
    console.log(`  ${sale.date} | ${sale.name} | ${sale.email} | ${sale.product} | ¥${sale.amount.toLocaleString()}`);
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
});
