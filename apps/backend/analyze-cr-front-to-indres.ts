/**
 * CR別: フロント購入→個別予約率の月別分析
 * 特定CRだけ悪いのか、全体的に落ちているのかを判定
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

async function getValues(id: string, range: string): Promise<string[][]> {
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId: id, range });
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

function extractCR(path: string): string | null {
  const m = path.match(/(CR\d{3,5})/);
  return m ? m[1] : null;
}

function pct(a: number, b: number): string {
  if (b === 0) return '-';
  return (a / b * 100).toFixed(1) + '%';
}

async function main() {
  console.log('=== CR別 フロント購入→個別予約率 月別分析 ===\n');

  // === 1. オプトイン取得 ===
  const ttOptRows = await getValues(CV_SHEET_ID, "'TT_オプト'!A1:F20000");
  const header = ttOptRows[0];
  let emailCol = -1, pathCol = -1, dateCol = -1;
  for (let j = 0; j < header.length; j++) {
    const h = (header[j] || '').trim();
    if (h.includes('メール')) emailCol = j;
    if (h.includes('登録経路') || h.includes('ファネル')) pathCol = j;
    if (h.includes('日時')) dateCol = j;
  }

  interface User { email: string; cr: string; date: Date; monthKey: string }
  const optins: User[] = [];
  for (let i = 1; i < ttOptRows.length; i++) {
    const row = ttOptRows[i];
    let email = (row[emailCol] || '').trim().toLowerCase();
    if (!email.includes('@')) {
      for (const cell of row) { if (cell?.includes('@')) { email = cell.trim().toLowerCase(); break; } }
    }
    const regPath = (row[pathCol] || '').trim();
    const date = parseDate((row[dateCol] || '').trim());
    if (!email.includes('@') || !date) continue;
    const cr = extractCR(regPath);
    if (!cr) continue;
    optins.push({ email, cr, date, monthKey: getMonthKey(date) });
  }
  console.log(`オプトイン（CR付き）: ${optins.length}件`);

  // === 2. フロント購入者取得 ===
  const frontEmails = new Set<string>();
  const frontByMonth = new Map<string, Set<string>>(); // monthKey → emails
  for (const sheetName of ['TT【OTO】', 'TT【3day】']) {
    const rows = await getValues(FRONT_SHEET_ID, `'${sheetName}'!A1:F10000`);
    const fh = rows[0] || [];
    let fe = -1, fd = -1;
    for (let j = 0; j < fh.length; j++) {
      if (fh[j]?.includes('メール')) fe = j;
      if (fh[j]?.includes('日時')) fd = j;
    }
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      let email = (row[fe] || '').trim().toLowerCase();
      if (!email.includes('@')) {
        for (const cell of row) { if (cell?.includes('@')) { email = cell.trim().toLowerCase(); break; } }
      }
      const date = parseDate((row[fd] || '').trim());
      if (!email.includes('@') || !date) continue;
      frontEmails.add(email);
      const mk = getMonthKey(date);
      if (!frontByMonth.has(mk)) frontByMonth.set(mk, new Set());
      frontByMonth.get(mk)!.add(email);
    }
  }
  console.log(`フロント購入者（ユニーク）: ${frontEmails.size}件`);

  // === 3. 個別予約の登録経路（AU列）取得 ===
  const allA = await getValues(INDRES_SHEET_ID, "'AI'!A1:A600");
  const auData = await getValues(INDRES_SHEET_ID, "'AI'!AU1:AU600");

  // 月別・CR別の個別予約数
  const indResByCrMonth = new Map<string, number>(); // "CR00xxx|2026-01" → count
  for (let i = 0; i < allA.length; i++) {
    const date = parseDate((allA[i]?.[0] || '').trim());
    if (!date) continue;
    const mk = getMonthKey(date);
    const auCell = (auData[i]?.[0] || '').trim();
    if (!auCell) continue;
    for (const line of auCell.split('\n')) {
      const cr = extractCR(line.trim());
      if (!cr) continue;
      const key = `${cr}|${mk}`;
      indResByCrMonth.set(key, (indResByCrMonth.get(key) || 0) + 1);
    }
  }

  // === 4. CR別・月別集計 ===
  const targetMonths = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];

  // 累積フロントメール（月末時点）
  const cumulFront = new Map<string, Set<string>>();
  const sortedAllMonths = [...new Set([...frontByMonth.keys()])].sort();
  const running = new Set<string>();
  for (const mk of sortedAllMonths) {
    for (const e of (frontByMonth.get(mk) || [])) running.add(e);
    cumulFront.set(mk, new Set(running));
  }

  // CR別データ構築
  interface CrData {
    cr: string;
    months: Map<string, { optins: number; frontPurchasers: number; indRes: number }>;
  }
  const crMap = new Map<string, CrData>();

  for (const opt of optins) {
    if (!targetMonths.includes(opt.monthKey)) continue;
    if (!crMap.has(opt.cr)) crMap.set(opt.cr, { cr: opt.cr, months: new Map() });
    const cd = crMap.get(opt.cr)!;
    if (!cd.months.has(opt.monthKey)) cd.months.set(opt.monthKey, { optins: 0, frontPurchasers: 0, indRes: 0 });
    const md = cd.months.get(opt.monthKey)!;
    md.optins++;
    const cf = cumulFront.get(opt.monthKey);
    if (cf?.has(opt.email)) md.frontPurchasers++;
  }

  // 個別予約数をCRに紐付け
  for (const [key, count] of indResByCrMonth) {
    const [cr, mk] = key.split('|');
    if (!targetMonths.includes(mk)) continue;
    if (!crMap.has(cr)) crMap.set(cr, { cr, months: new Map() });
    const cd = crMap.get(cr)!;
    if (!cd.months.has(mk)) cd.months.set(mk, { optins: 0, frontPurchasers: 0, indRes: 0 });
    cd.months.get(mk)!.indRes += count;
  }

  // === 5. 月別集計: フロント購入CRの個別予約率 vs 全体 ===
  console.log('\n' + '='.repeat(80));
  console.log('【1. 月別: フロント購入があるCR vs ないCR の個別予約数】\n');

  for (const mk of targetMonths) {
    let frontCr_optins = 0, frontCr_front = 0, frontCr_indres = 0, frontCr_count = 0;
    let noFrontCr_optins = 0, noFrontCr_indres = 0, noFrontCr_count = 0;

    for (const [, cd] of crMap) {
      const md = cd.months.get(mk);
      if (!md) continue;
      if (md.frontPurchasers > 0) {
        frontCr_count++;
        frontCr_optins += md.optins;
        frontCr_front += md.frontPurchasers;
        frontCr_indres += md.indRes;
      } else {
        noFrontCr_count++;
        noFrontCr_optins += md.optins;
        noFrontCr_indres += md.indRes;
      }
    }

    console.log(`${mk}:`);
    console.log(`  フロント購入CR: ${frontCr_count}本 | オプト${frontCr_optins} | フロント${frontCr_front} | 個別予約${frontCr_indres} | フロント→個別率${pct(frontCr_indres, frontCr_front)}`);
    console.log(`  未購入CR:       ${noFrontCr_count}本 | オプト${noFrontCr_optins} | 個別予約${noFrontCr_indres} | オプト→個別率${pct(noFrontCr_indres, noFrontCr_optins)}`);
    console.log();
  }

  // === 6. 個別CR別のフロント→個別予約率（フロント購入5件以上のCR） ===
  console.log('='.repeat(80));
  console.log('【2. CR別 フロント→個別予約率（累計フロント購入5件以上のCR）】\n');

  // 全期間累計でフロント購入が多いCRをリストアップ
  interface CrSummary {
    cr: string;
    totalOptins: number;
    totalFront: number;
    totalIndRes: number;
    monthlyData: { mk: string; optins: number; front: number; indRes: number }[];
  }
  const crSummaries: CrSummary[] = [];

  for (const [, cd] of crMap) {
    let totalOptins = 0, totalFront = 0, totalIndRes = 0;
    const monthlyData: CrSummary['monthlyData'] = [];
    for (const mk of targetMonths) {
      const md = cd.months.get(mk);
      if (md) {
        totalOptins += md.optins;
        totalFront += md.frontPurchasers;
        totalIndRes += md.indRes;
        if (md.optins > 0 || md.indRes > 0) {
          monthlyData.push({ mk, optins: md.optins, front: md.frontPurchasers, indRes: md.indRes });
        }
      }
    }
    if (totalFront >= 5) {
      crSummaries.push({ cr: cd.cr, totalOptins, totalFront, totalIndRes, monthlyData });
    }
  }

  crSummaries.sort((a, b) => b.totalFront - a.totalFront);

  console.log(`CR     | 累計オプト | 累計フロント | 累計個別予約 | フロント→個別率 | 月別内訳`);
  console.log('-------|----------|-----------|-----------|--------------|--------');
  for (const cs of crSummaries.slice(0, 30)) {
    const monthly = cs.monthlyData.map(d => `${d.mk.slice(5)}:F${d.front}/I${d.indRes}`).join(' ');
    console.log(`${cs.cr.padEnd(7)}| ${String(cs.totalOptins).padStart(8)} | ${String(cs.totalFront).padStart(9)} | ${String(cs.totalIndRes).padStart(9)} | ${pct(cs.totalIndRes, cs.totalFront).padStart(12)} | ${monthly}`);
  }

  // === 7. 時系列で「古いCR」vs「新しいCR」 ===
  console.log('\n' + '='.repeat(80));
  console.log('【3. 古いCR（CR00xxx） vs 新しいCR（CR01xxx）のフロント→個別予約率】\n');

  for (const mk of targetMonths) {
    let old_front = 0, old_indres = 0, new_front = 0, new_indres = 0;
    for (const [, cd] of crMap) {
      const md = cd.months.get(mk);
      if (!md || md.frontPurchasers === 0) continue;
      const crNum = parseInt(cd.cr.replace('CR', ''));
      if (crNum < 1000) {
        old_front += md.frontPurchasers;
        old_indres += md.indRes;
      } else {
        new_front += md.frontPurchasers;
        new_indres += md.indRes;
      }
    }
    console.log(`${mk}: 古CR(00xxx) F${old_front}→I${old_indres} ${pct(old_indres, old_front)} | 新CR(01xxx) F${new_front}→I${new_indres} ${pct(new_indres, new_front)}`);
  }

  // === 8. オプトインからの日数分析 ===
  console.log('\n' + '='.repeat(80));
  console.log('【4. 個別予約までのリードタイム分析】\n');
  console.log('※ 個別予約の登録経路(CR) → そのCRの最初のオプトイン日からの経過日数\n');

  // CRの最初のオプトイン日
  const crFirstOptin = new Map<string, Date>();
  for (const opt of optins) {
    if (!crFirstOptin.has(opt.cr) || opt.date < crFirstOptin.get(opt.cr)!) {
      crFirstOptin.set(opt.cr, opt.date);
    }
  }

  // 個別予約の日付とCRからリードタイム計算
  const leadTimeByMonth = new Map<string, number[]>();
  for (let i = 0; i < allA.length; i++) {
    const date = parseDate((allA[i]?.[0] || '').trim());
    if (!date) continue;
    const mk = getMonthKey(date);
    if (!targetMonths.includes(mk)) continue;
    const auCell = (auData[i]?.[0] || '').trim();
    if (!auCell) continue;
    for (const line of auCell.split('\n')) {
      const cr = extractCR(line.trim());
      if (!cr) continue;
      const firstOptin = crFirstOptin.get(cr);
      if (!firstOptin) continue;
      const daysDiff = Math.floor((date.getTime() - firstOptin.getTime()) / (86400000));
      if (!leadTimeByMonth.has(mk)) leadTimeByMonth.set(mk, []);
      leadTimeByMonth.get(mk)!.push(daysDiff);
    }
  }

  for (const mk of targetMonths) {
    const days = leadTimeByMonth.get(mk) || [];
    if (days.length === 0) { console.log(`${mk}: データなし`); continue; }
    days.sort((a, b) => a - b);
    const avg = days.reduce((a, b) => a + b, 0) / days.length;
    const median = days[Math.floor(days.length / 2)];
    const within7 = days.filter(d => d <= 7).length;
    const within30 = days.filter(d => d <= 30).length;
    const over30 = days.filter(d => d > 30).length;
    console.log(`${mk}: 件数${days.length} | 平均${avg.toFixed(0)}日 | 中央値${median}日 | 7日以内${within7}(${pct(within7, days.length)}) | 30日以内${within30}(${pct(within30, days.length)}) | 30日超${over30}(${pct(over30, days.length)})`);
  }
}

main().catch(console.error);
