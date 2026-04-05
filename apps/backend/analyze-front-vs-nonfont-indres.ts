/**
 * AI導線: フロント購入者 vs 未購入者の個別予約率 月別分析
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

const FRONT_SHEET_ID = '1PvyM6JkFuQR_lc4QyZFaMX0GA0Rn0_6Bll9mjh0RNFs';
const CV_SHEET_ID = '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk';
const INDRES_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function getValues(spreadsheetId: string, range: string): Promise<string[][]> {
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  return (res.data.values || []) as string[][];
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const m = s.trim().match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
}

function getMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function pct(a: number, b: number): string {
  if (b === 0) return '-';
  return (a / b * 100).toFixed(1) + '%';
}

// CRnumber抽出（色々な形式に対応）
function extractCR(path: string): string | null {
  // TikTok広告-AI-LP1-CR00952 形式
  const m1 = path.match(/(CR\d{3,5})/);
  if (m1) return m1[1];
  return null;
}

async function main() {
  console.log('=== AI導線: フロント購入者 vs 未購入者 個別予約率分析 ===\n');

  // === 1. TT_オプトイン取得 ===
  // TT_オプトの列構造: [0]お名前/メール [1]メール [2]電話/URL [3]URL/登録経路 [4]登録経路/日時 [5]日時
  // データ行は列がずれている場合がある
  const ttOptRows = await getValues(CV_SHEET_ID, "'TT_オプト'!A1:F20000");
  console.log(`TT_オプト 全行数: ${ttOptRows.length}`);

  // ヘッダー確認
  const header = ttOptRows[0];
  console.log(`ヘッダー: ${header.map((v, i) => `[${i}]${v}`).join(' | ')}`);

  // サンプル表示
  for (let i = Math.max(1, ttOptRows.length - 5); i < ttOptRows.length; i++) {
    const r = ttOptRows[i];
    console.log(`最新行${i}: ${r.map((v, j) => `[${j}]${(v || '').substring(0, 40)}`).join(' | ')}`);
  }

  // メールと日付を柔軟にパース
  interface OptinUser { email: string; cr: string | null; date: Date; monthKey: string }
  const optins: OptinUser[] = [];

  // ヘッダーから列位置を特定
  let emailCol = -1, pathCol = -1, dateCol = -1;
  for (let j = 0; j < header.length; j++) {
    const h = (header[j] || '').trim();
    if (h.includes('メール')) emailCol = j;
    if (h.includes('登録経路') || h.includes('ファネル')) pathCol = j;
    if (h.includes('日時') || h.includes('日付')) dateCol = j;
  }
  console.log(`\n列位置: email=${emailCol}, path=${pathCol}, date=${dateCol}`);

  for (let i = 1; i < ttOptRows.length; i++) {
    const row = ttOptRows[i];
    // メールは指定列、もしくはrow内で@を含む最初のセル
    let email = emailCol >= 0 ? (row[emailCol] || '').trim() : '';
    if (!email.includes('@')) {
      for (const cell of row) {
        if (cell && cell.includes('@')) { email = cell.trim(); break; }
      }
    }
    email = email.toLowerCase();

    const regPath = pathCol >= 0 ? (row[pathCol] || '').trim() : '';
    const dateStr = dateCol >= 0 ? (row[dateCol] || '').trim() : '';
    const date = parseDate(dateStr);
    if (!email.includes('@') || !date) continue;

    const cr = extractCR(regPath);
    optins.push({ email, cr, date, monthKey: getMonthKey(date) });
  }

  // 月別分布
  const monthDist = new Map<string, number>();
  for (const o of optins) {
    monthDist.set(o.monthKey, (monthDist.get(o.monthKey) || 0) + 1);
  }
  console.log('\nオプトイン月別分布:');
  for (const [k, v] of [...monthDist.entries()].sort()) console.log(`  ${k}: ${v}件`);

  // === 2. フロント購入者取得 ===
  interface FrontPurchaser { email: string; cr: string | null; date: Date; monthKey: string }
  const frontPurchasers: FrontPurchaser[] = [];

  for (const sheetName of ['TT【OTO】', 'TT【3day】']) {
    const rows = await getValues(FRONT_SHEET_ID, `'${sheetName}'!A1:F10000`);
    const fHeader = rows[0] || [];
    let fEmailCol = -1, fPathCol = -1, fDateCol = -1;
    for (let j = 0; j < fHeader.length; j++) {
      const h = (fHeader[j] || '').trim();
      if (h.includes('メール')) fEmailCol = j;
      if (h.includes('登録経路') || h.includes('ファネル')) fPathCol = j;
      if (h.includes('日時') || h.includes('日付')) fDateCol = j;
    }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      let email = fEmailCol >= 0 ? (row[fEmailCol] || '').trim() : '';
      if (!email.includes('@')) {
        for (const cell of row) {
          if (cell && cell.includes('@')) { email = cell.trim(); break; }
        }
      }
      email = email.toLowerCase();
      const regPath = fPathCol >= 0 ? (row[fPathCol] || '').trim() : '';
      const dateStr = fDateCol >= 0 ? (row[fDateCol] || '').trim() : '';
      const date = parseDate(dateStr);
      if (!email.includes('@') || !date) continue;
      frontPurchasers.push({ email, cr: extractCR(regPath), date, monthKey: getMonthKey(date) });
    }
  }
  console.log(`\nフロント購入者: ${frontPurchasers.length}件`);

  // 月別分布
  const fpMonthDist = new Map<string, number>();
  for (const fp of frontPurchasers) fpMonthDist.set(fp.monthKey, (fpMonthDist.get(fp.monthKey) || 0) + 1);
  console.log('フロント購入 月別分布:');
  for (const [k, v] of [...fpMonthDist.entries()].sort()) console.log(`  ${k}: ${v}件`);

  // フロント購入者メールセット（累積）
  const frontEmailsByEndOfMonth = new Map<string, Set<string>>();
  const allFrontEmails = new Set<string>();
  const sortedMonths = [...new Set([...monthDist.keys(), ...fpMonthDist.keys()])].sort();
  for (const mk of sortedMonths) {
    // この月のフロント購入者を追加
    for (const fp of frontPurchasers.filter(f => f.monthKey <= mk)) {
      allFrontEmails.add(fp.email);
    }
    frontEmailsByEndOfMonth.set(mk, new Set(allFrontEmails));
  }

  // === 3. 個別予約の登録経路を月別に取得 ===
  const allA = await getValues(INDRES_SHEET_ID, "'AI'!A1:A600");
  const auData = await getValues(INDRES_SHEET_ID, "'AI'!AU1:AU600");

  interface IndResEntry { date: Date; monthKey: string; paths: string[] }
  const indResEntries: IndResEntry[] = [];
  for (let i = 0; i < allA.length; i++) {
    const date = parseDate((allA[i]?.[0] || '').trim());
    if (!date) continue;
    const auCell = (auData[i]?.[0] || '').trim();
    if (!auCell) continue;
    const paths = auCell.split('\n').map(p => p.trim()).filter(p => p && p !== '不明');
    if (paths.length > 0) indResEntries.push({ date, monthKey: getMonthKey(date), paths });
  }

  // === 4. CR→メールのマッピング ===
  const crToEmails = new Map<string, Set<string>>();
  for (const opt of optins) {
    if (!opt.cr) continue;
    if (!crToEmails.has(opt.cr)) crToEmails.set(opt.cr, new Set());
    crToEmails.get(opt.cr)!.add(opt.email);
  }

  // === 5. 月別分析 ===
  const targetMonths = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];

  interface MonthResult {
    monthKey: string;
    totalOptins: number;
    frontPurchaserOptins: number; // この月のオプトインのうちフロント購入者
    nonFrontOptins: number;
    totalIndRes: number;
    indResFromFrontCR: number;
    indResFromNonFrontCR: number;
    indResUnknown: number;
  }
  const results: MonthResult[] = [];

  for (const mk of targetMonths) {
    const monthOptins = optins.filter(o => o.monthKey === mk);
    const cumulFrontEmails = frontEmailsByEndOfMonth.get(mk) || new Set();

    // この月のオプトインを分類
    let fpCount = 0, nfCount = 0;
    for (const opt of monthOptins) {
      if (cumulFrontEmails.has(opt.email)) fpCount++;
      else nfCount++;
    }

    // 個別予約を分類
    const monthIndRes = indResEntries.filter(e => e.monthKey === mk);
    let total = 0, fromFront = 0, fromNon = 0, unknown = 0;
    for (const entry of monthIndRes) {
      for (const path of entry.paths) {
        total++;
        const cr = extractCR(path);
        if (!cr) { unknown++; continue; }
        const emails = crToEmails.get(cr);
        if (!emails || emails.size === 0) { unknown++; continue; }
        let hasFront = false;
        for (const e of emails) {
          if (cumulFrontEmails.has(e)) { hasFront = true; break; }
        }
        if (hasFront) fromFront++; else fromNon++;
      }
    }

    results.push({
      monthKey: mk,
      totalOptins: monthOptins.length,
      frontPurchaserOptins: fpCount,
      nonFrontOptins: nfCount,
      totalIndRes: total,
      indResFromFrontCR: fromFront,
      indResFromNonFrontCR: fromNon,
      indResUnknown: unknown,
    });
  }

  // === 6. 結果出力 ===
  console.log('\n\n' + '='.repeat(75));
  console.log('【結果1: 月別オプトイン→フロント購入率（メール突合）】\n');
  console.log('月      | TT_オプト | うちフロント購入 | 未購入  | フロント率');
  console.log('--------|----------|----------------|---------|----------');
  for (const r of results) {
    console.log(`${r.monthKey} | ${String(r.totalOptins).padStart(8)} | ${String(r.frontPurchaserOptins).padStart(14)} | ${String(r.nonFrontOptins).padStart(7)} | ${pct(r.frontPurchaserOptins, r.totalOptins).padStart(8)}`);
  }

  console.log('\n' + '='.repeat(75));
  console.log('【結果2: 個別予約の出所（CRベース推定）】\n');
  console.log('※ 個別予約の登録経路(CR)のオプトインメンバーにフロント購入者がいるかで分類\n');
  console.log('月      | 個別予約計 | フロントCRから | 非フロントCRから | 不明');
  console.log('--------|----------|-------------|---------------|------');
  for (const r of results) {
    console.log(`${r.monthKey} | ${String(r.totalIndRes).padStart(8)} | ${String(r.indResFromFrontCR).padStart(11)} | ${String(r.indResFromNonFrontCR).padStart(13)} | ${String(r.indResUnknown).padStart(4)}`);
  }

  console.log('\n' + '='.repeat(75));
  console.log('【結果3: フロント購入者 vs 未購入者 個別予約率（推定）】\n');
  console.log('月      | 購入者→個別率   | 未購入者→個別率  | 全体→個別率');
  console.log('--------|---------------|-----------------|----------');
  for (const r of results) {
    console.log(`${r.monthKey} | ${pct(r.indResFromFrontCR, r.frontPurchaserOptins).padStart(13)} | ${pct(r.indResFromNonFrontCR, r.nonFrontOptins).padStart(15)} | ${pct(r.totalIndRes, r.totalOptins).padStart(8)}`);
  }
}

main().catch(console.error);
