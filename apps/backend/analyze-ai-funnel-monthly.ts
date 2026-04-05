/**
 * AI導線 月別ファネル分析
 * フロント購入者/未購入者の個別予約率を月別に比較
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

const SPREADSHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';
const SHEET_NAME = 'AI';

// AI列マッピング
const COL = {
  impressions: 2,    // C
  clicks: 5,         // F
  optins: 11,        // L
  listIns: 13,       // N
  cpc: 17,           // R
  frontPurchase: 21, // V
  secretRoom: 24,    // Y
  seiyaku: 27,       // AB (成約数)
  revenue: 34,       // AI
  optinLTV: 36,      // AK
  individualRes: 38, // AM
  adSpend: 44,       // AS
};

function parseNum(v: string | undefined): number {
  if (!v) return 0;
  const cleaned = String(v).replace(/[¥,%％]/g, '').replace(/,/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function pct(a: number, b: number): string {
  if (b === 0) return '-';
  return (a / b * 100).toFixed(1) + '%';
}

async function getSheetValues(range: string): Promise<string[][]> {
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });
  return (res.data.values || []) as string[][];
}

interface MonthData {
  label: string;
  optins: number;
  frontPurchase: number;
  secretRoom: number;
  listIns: number;
  individualRes: number;
  seiyaku: number;
  adSpend: number;
  revenue: number;
}

async function main() {
  console.log('=== AI導線 月別ファネル推移分析 ===\n');
  console.log('目的: オプト→個別予約率低下の原因を特定\n');

  // まずA列全体を読んで月ブロックの位置を特定
  const allA = await getSheetValues(`'${SHEET_NAME}'!A1:A600`);

  // 分析対象の月
  const targetMonths = [
    { year: 2025, month: 11, label: '2025年11月' },
    { year: 2025, month: 12, label: '2025年12月' },
    { year: 2026, month: 1, label: '2026年1月' },
    { year: 2026, month: 2, label: '2026年2月' },
    { year: 2026, month: 3, label: '2026年3月' },
  ];

  const results: MonthData[] = [];

  for (const target of targetMonths) {
    const monthLabel = `${target.month}月`;
    const datePrefix1 = `${target.year}/${target.month}/`;
    const datePrefix2 = `${target.year}/${String(target.month).padStart(2, '0')}/`;

    // 月ラベル行を探す
    let summaryRow = -1;
    for (let i = 0; i < allA.length; i++) {
      const val = (allA[i]?.[0] || '').trim();
      if (val === monthLabel) {
        const nextVal = (allA[i + 1]?.[0] || '').trim();
        if (nextVal.startsWith(datePrefix1) || nextVal.startsWith(datePrefix2)) {
          summaryRow = i + 1; // 1-indexed
          break;
        }
      }
    }

    if (summaryRow === -1) {
      console.log(`⚠ ${target.label}のデータが見つかりません`);
      continue;
    }

    // 月集計行を読む
    const row = (await getSheetValues(`'${SHEET_NAME}'!A${summaryRow}:AX${summaryRow}`))[0] || [];

    results.push({
      label: target.label,
      optins: parseNum(row[COL.optins]),
      frontPurchase: parseNum(row[COL.frontPurchase]),
      secretRoom: parseNum(row[COL.secretRoom]),
      listIns: parseNum(row[COL.listIns]),
      individualRes: parseNum(row[COL.individualRes]),
      seiyaku: parseNum(row[COL.seiyaku]),
      adSpend: parseNum(row[COL.adSpend]),
      revenue: parseNum(row[COL.revenue]),
    });
  }

  // === 1. 基本ファネル数値 ===
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【1. 基本ファネル数値（月別）】\n');
  console.log('月          | オプト | フロント | 秘密の部屋 | LINE登録 | 個別予約 | 成約');
  console.log('------------|--------|----------|------------|----------|---------|------');
  for (const r of results) {
    console.log(`${r.label.padEnd(10)} | ${String(r.optins).padStart(6)} | ${String(r.frontPurchase).padStart(8)} | ${String(r.secretRoom).padStart(10)} | ${String(r.listIns).padStart(8)} | ${String(r.individualRes).padStart(7)} | ${String(r.seiyaku).padStart(4)}`);
  }

  // === 2. 転換率推移 ===
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【2. ファネル転換率推移】\n');
  console.log('月          | オプト→フロント | フロント→個別 | オプト→個別 | 個別→成約');
  console.log('------------|----------------|--------------|------------|----------');
  for (const r of results) {
    console.log(`${r.label.padEnd(10)} | ${pct(r.frontPurchase, r.optins).padStart(14)} | ${pct(r.individualRes, r.frontPurchase).padStart(12)} | ${pct(r.individualRes, r.optins).padStart(10)} | ${pct(r.seiyaku, r.individualRes).padStart(8)}`);
  }

  // === 3. フロント購入者/未購入者の個別予約率推定 ===
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【3. フロント購入有無×個別予約の分解】\n');
  console.log('※ 仮定: 個別予約はフロント購入者・未購入者の両方から発生しうる');
  console.log('※ フロント→個別の比率と、全体の個別予約数から逆算\n');

  console.log('月          | フロント | フロント未 | フロント→個別 | 未購入→個別 | 全体個別率');
  console.log('            | 購入者数 | 購入者数   | (上限推定)   | (残り推定)  | (実績)');
  console.log('------------|----------|-----------|-------------|------------|----------');
  for (const r of results) {
    const nonFront = r.optins - r.frontPurchase;
    // 個別予約がフロント購入者数を超えていたら、全員は無理なので上限を設定
    const maxFromFront = Math.min(r.individualRes, r.frontPurchase);
    const fromNonFront = r.individualRes - maxFromFront;

    // もしフロント→個別が100%超えない妥当な範囲を出す
    console.log(`${r.label.padEnd(10)} | ${String(r.frontPurchase).padStart(8)} | ${String(nonFront).padStart(9)} | ${pct(maxFromFront, r.frontPurchase).padStart(11)} | ${pct(fromNonFront, nonFront).padStart(10)} | ${pct(r.individualRes, r.optins).padStart(8)}`);
  }

  // === 4. 経済性分析 ===
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【4. 経済性指標】\n');
  console.log('月          | 広告費       | CPA        | フロントCPO | 個別CPO      | 売上');
  console.log('------------|-------------|------------|-----------|-------------|--------');
  for (const r of results) {
    const cpa = r.optins > 0 ? Math.round(r.adSpend / r.optins) : 0;
    const frontCpo = r.frontPurchase > 0 ? Math.round(r.adSpend / r.frontPurchase) : 0;
    const indivCpo = r.individualRes > 0 ? Math.round(r.adSpend / r.individualRes) : 0;
    console.log(`${r.label.padEnd(10)} | ¥${String(Math.round(r.adSpend).toLocaleString()).padStart(10)} | ¥${String(cpa.toLocaleString()).padStart(8)} | ¥${String(frontCpo.toLocaleString()).padStart(8)} | ¥${String(indivCpo.toLocaleString()).padStart(10)} | ¥${String(Math.round(r.revenue).toLocaleString()).padStart(10)}`);
  }

  // === 5. 月別変化の要因分解 ===
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【5. 前月比変化の要因分解】\n');
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1];
    const curr = results[i];

    const prevOptToIndiv = prev.optins > 0 ? prev.individualRes / prev.optins : 0;
    const currOptToIndiv = curr.optins > 0 ? curr.individualRes / curr.optins : 0;
    const prevOptToFront = prev.optins > 0 ? prev.frontPurchase / prev.optins : 0;
    const currOptToFront = curr.optins > 0 ? curr.frontPurchase / curr.optins : 0;
    const prevFrontToIndiv = prev.frontPurchase > 0 ? prev.individualRes / prev.frontPurchase : 0;
    const currFrontToIndiv = curr.frontPurchase > 0 ? curr.individualRes / curr.frontPurchase : 0;

    console.log(`${prev.label} → ${curr.label}:`);
    console.log(`  オプト→個別率: ${(prevOptToIndiv * 100).toFixed(1)}% → ${(currOptToIndiv * 100).toFixed(1)}% (${currOptToIndiv >= prevOptToIndiv ? '↑' : '↓'}${Math.abs((currOptToIndiv - prevOptToIndiv) * 100).toFixed(1)}pt)`);
    console.log(`  オプト→フロント率: ${(prevOptToFront * 100).toFixed(1)}% → ${(currOptToFront * 100).toFixed(1)}% (${currOptToFront >= prevOptToFront ? '↑' : '↓'}${Math.abs((currOptToFront - prevOptToFront) * 100).toFixed(1)}pt)`);
    console.log(`  フロント→個別率: ${(prevFrontToIndiv * 100).toFixed(1)}% → ${(currFrontToIndiv * 100).toFixed(1)}% (${currFrontToIndiv >= prevFrontToIndiv ? '↑' : '↓'}${Math.abs((currFrontToIndiv - prevFrontToIndiv) * 100).toFixed(1)}pt)`);
    console.log();
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('分析ポイント:');
  console.log('- オプト→フロント率が落ちているなら、フロントオファーの質/訴求力の問題');
  console.log('- フロント→個別率が落ちているなら、フロント後のナーチャリング/導線の問題');
  console.log('- 両方落ちているなら、集客の質（オプトインの質）自体の低下の可能性');
}

main().catch(console.error);
