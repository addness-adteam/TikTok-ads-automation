/**
 * 再出稿候補の個別予約CPOチェック
 * 許容値 ¥53,795 を満たしているか確認
 *
 * npx tsx apps/backend/check-candidate-indres-cpo.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

import { google } from 'googleapis';

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const INDIVIDUAL_RESERVATION_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';
const ALLOWABLE_IND_RES_CPO = 53795;

const ACCOUNTS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
];

// 再出稿候補のキャンペーンID（前回の分析結果から）
const CANDIDATES = [
  // Tier 1
  { campId: '1860642870567953', accId: '7468288053866561553', name: 'AI_1 | 過去の当たりCR/LP1-CR01105', tier: 1 },
  { campId: '1861004791150721', accId: '7523128243466551303', name: 'AI_2 | 過去の当たりCR/LP1-CR01132', tier: 1 },
  { campId: '1861474097696017', accId: '7523128243466551303', name: 'AI_2 | CR454横展開/LP1-CR01150', tier: 1 },
  { campId: '1857763139065041', accId: '7468288053866561553', name: 'AI_1 | 尻込み＿ちえみさん/LP1-CR00928', tier: 1 },
  // Tier 2
  { campId: '1859378063712466', accId: '7468288053866561553', name: 'AI_1 | ClaudeCode解説/LP1-CR01047', tier: 2 },
  { campId: '1859273212782882', accId: '7468288053866561553', name: 'AI_1 | ClaudeCode解説/LP2-CR00223', tier: 2 },
  { campId: '1860803930046657', accId: '7468288053866561553', name: 'AI_1 | ClaudeCode解説/LP1-CR01127', tier: 2 },
  { campId: '1857745362755634', accId: '7468288053866561553', name: 'AI_1 | お絵描きムービー/LP2-CR00199', tier: 2 },
  { campId: '1857142891950097', accId: '7468288053866561553', name: 'AI_1 | お絵描きムービー/LP2-CR00189', tier: 2 },
  { campId: '1857994115998737', accId: '7468288053866561553', name: 'AI_1 | 急募＿女性走る②/LP1-CR00941', tier: 2 },
  { campId: '1860510968813745', accId: '7523128243466551303', name: 'AI_2 | ClaudeCodeレベル/LP1-CR01099', tier: 2 },
  // Tier 3
  { campId: '1860511909076033', accId: '7468288053866561553', name: 'AI_1 | 箕輪さんまとめ/LP4-CR00003', tier: 3 },
  { campId: '1861681683326017', accId: '7468288053866561553', name: 'AI_1 | やれやめろ＿編集強化/LP1-CR01169', tier: 3 },
  { campId: '1860116987331794', accId: '7523128243466551303', name: 'AI_2 | 林社長/冒頭③/LP2-CR00230', tier: 3 },
  { campId: '1861321122771298', accId: '7468288053866561553', name: 'AI_1 | AI全部やめました渋谷Ver/LP1-CR01144', tier: 1 },
];

function jstDate(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')}`;
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

function extractLpCr(name: string): string | null {
  const match = name.match(/(LP\d+-CR\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

async function main() {
  console.log(`=== 再出稿候補 個別予約CPOチェック ===`);
  console.log(`許容値: ¥${ALLOWABLE_IND_RES_CPO.toLocaleString()}\n`);

  // 1. スプレッドシートから個別予約データ取得
  console.log('個別予約スプレッドシート取得中...');
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const sheetRes = await sheets.spreadsheets.values.get({
    spreadsheetId: INDIVIDUAL_RESERVATION_SHEET_ID,
    range: 'AI!A:AZ',
  });
  const rows = sheetRes.data.values || [];
  console.log(`  AI シート: ${rows.length}行\n`);

  // LP-CRごとの個別予約数を集計
  const indResByLpCr = new Map<string, { count: number; dates: string[] }>();

  for (const row of rows.slice(1)) { // ヘッダースキップ
    const dateStr = row[0] || '';
    const pathCell = row[46] || ''; // AU列
    const lines = pathCell.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const lpCr = extractLpCr(trimmed);
      if (!lpCr) continue;

      if (!indResByLpCr.has(lpCr)) indResByLpCr.set(lpCr, { count: 0, dates: [] });
      const entry = indResByLpCr.get(lpCr)!;
      entry.count++;
      entry.dates.push(dateStr);
    }
  }

  console.log(`LP-CR別 個別予約数: ${indResByLpCr.size}件のLP-CRにデータあり\n`);

  // 2. 候補キャンペーンごとに費用と個別予約CPOを算出
  const now = new Date();
  const endDate = jstDate(now);
  const midDate = jstDate(new Date(now.getTime() - 29 * 86400000));
  const startDate = jstDate(new Date(now.getTime() - 59 * 86400000));
  const periods = [
    { start: startDate, end: midDate },
    { start: addDays(midDate, 1), end: endDate },
  ];

  // キャンペーンごとの累計費用を取得
  const campSpend = new Map<string, number>();
  const campCv = new Map<string, number>();

  for (const acc of ACCOUNTS) {
    for (const period of periods) {
      let page = 1;
      while (true) {
        const resp = await get('/v1.3/report/integrated/get/', {
          advertiser_id: acc.id, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
          dimensions: JSON.stringify(['campaign_id']),
          metrics: JSON.stringify(['spend', 'conversion']),
          start_date: period.start, end_date: period.end, page_size: '1000', page: String(page),
        });
        if (resp.code !== 0) break;
        for (const row of resp.data?.list || []) {
          const campId = row.dimensions?.campaign_id;
          const spend = parseFloat(row.metrics?.spend || '0');
          const cv = parseInt(row.metrics?.conversion || '0');
          campSpend.set(campId, (campSpend.get(campId) || 0) + spend);
          campCv.set(campId, (campCv.get(campId) || 0) + cv);
        }
        if ((resp.data?.list || []).length < 1000) break;
        page++;
      }
    }
  }

  // LP-CRが同じキャンペーンが複数ある場合、費用を合算する必要がある
  // まずキャンペーン名からLP-CRを取得
  const campLpCr = new Map<string, string>();
  for (const c of CANDIDATES) {
    const lpCr = extractLpCr(c.name);
    if (lpCr) campLpCr.set(c.campId, lpCr);
  }

  // 同じLP-CRの全キャンペーンの費用を合算
  const lpCrTotalSpend = new Map<string, number>();
  const lpCrTotalCv = new Map<string, number>();

  // 候補キャンペーンの費用
  for (const c of CANDIDATES) {
    const lpCr = campLpCr.get(c.campId);
    if (!lpCr) continue;
    const spend = campSpend.get(c.campId) || 0;
    const cv = campCv.get(c.campId) || 0;
    lpCrTotalSpend.set(lpCr, (lpCrTotalSpend.get(lpCr) || 0) + spend);
    lpCrTotalCv.set(lpCr, (lpCrTotalCv.get(lpCr) || 0) + cv);
  }

  // ただし同じLP-CRの他キャンペーン（候補外）の費用も加算する必要がある
  // → 全キャンペーンの名前を取得してLP-CRマッチング
  console.log('全キャンペーンの費用集計中...');

  for (const acc of ACCOUNTS) {
    let page = 1;
    while (true) {
      const cr = await get('/v1.3/campaign/get/', {
        advertiser_id: acc.id, page_size: '100', page: String(page),
        fields: JSON.stringify(['campaign_id', 'campaign_name']),
      });
      if (cr.code !== 0) break;
      for (const c of cr.data?.list || []) {
        const lpCr = extractLpCr(c.campaign_name || '');
        if (!lpCr) continue;
        // このLP-CRが候補に含まれているか
        if (!lpCrTotalSpend.has(lpCr)) continue;
        // 候補以外のキャンペーンの費用も加算
        const spend = campSpend.get(c.campaign_id) || 0;
        const cv = campCv.get(c.campaign_id) || 0;
        if (spend > 0 && !CANDIDATES.some(cand => cand.campId === c.campaign_id)) {
          lpCrTotalSpend.set(lpCr, lpCrTotalSpend.get(lpCr)! + spend);
          lpCrTotalCv.set(lpCr, lpCrTotalCv.get(lpCr)! + cv);
        }
      }
      if ((cr.data?.list || []).length < 100) break;
      page++;
    }
  }

  // 3. 結果表示
  console.log('\n========================================');
  console.log('再出稿候補 個別予約CPO一覧');
  console.log('========================================\n');

  // LP-CR単位でユニークにまとめて表示
  const displayedLpCr = new Set<string>();

  interface Result {
    lpCr: string; tier: number; names: string[];
    totalSpend: number; totalCv: number; indRes: number;
    cpo: number | null; verdict: string;
  }

  const results: Result[] = [];

  for (const c of CANDIDATES) {
    const lpCr = campLpCr.get(c.campId);
    if (!lpCr || displayedLpCr.has(lpCr)) continue;
    displayedLpCr.add(lpCr);

    const spend = lpCrTotalSpend.get(lpCr) || 0;
    const cv = lpCrTotalCv.get(lpCr) || 0;
    const indRes = indResByLpCr.get(lpCr)?.count || 0;
    const cpo = indRes > 0 ? spend / indRes : null;

    let verdict = '';
    if (indRes === 0) {
      verdict = '個別予約0件（判定不可）';
    } else if (cpo! <= ALLOWABLE_IND_RES_CPO) {
      verdict = '✓ OK';
    } else if (cpo! <= ALLOWABLE_IND_RES_CPO * 2) {
      verdict = '△ KPI超過';
    } else {
      verdict = '✗ 撤退ライン超過';
    }

    const names = CANDIDATES.filter(cc => campLpCr.get(cc.campId) === lpCr).map(cc => cc.name);

    results.push({ lpCr, tier: c.tier, names, totalSpend: spend, totalCv: cv, indRes, cpo, verdict });
  }

  // Tier順→CPO順でソート
  results.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.cpo === null) return 1;
    if (b.cpo === null) return -1;
    return a.cpo - b.cpo;
  });

  for (const r of results) {
    const cpoStr = r.cpo !== null ? `¥${Math.round(r.cpo).toLocaleString()}` : '-';
    console.log(`[Tier ${r.tier}] ${r.lpCr} | ${r.verdict}`);
    console.log(`  費用合計: ¥${Math.round(r.totalSpend).toLocaleString()} | オプト: ${r.totalCv}件 | 個別予約: ${r.indRes}件 | CPO: ${cpoStr}`);
    console.log(`  CPA: ¥${r.totalCv > 0 ? Math.round(r.totalSpend / r.totalCv).toLocaleString() : '-'}`);
    for (const n of r.names) console.log(`    ${n}`);
    console.log('');
  }

  // サマリー
  console.log('========================================');
  console.log('判定サマリー');
  console.log('========================================\n');

  const ok = results.filter(r => r.verdict.includes('OK'));
  const ng = results.filter(r => r.verdict.includes('超過'));
  const unknown = results.filter(r => r.verdict.includes('判定不可'));

  console.log(`✓ 再出稿OK: ${ok.length}件`);
  for (const r of ok) console.log(`  ${r.lpCr} | CPO ¥${Math.round(r.cpo!).toLocaleString()}`);

  console.log(`\n△✗ KPI超過/撤退: ${ng.length}件`);
  for (const r of ng) console.log(`  ${r.lpCr} | CPO ¥${r.cpo ? Math.round(r.cpo).toLocaleString() : '-'} | ${r.verdict}`);

  console.log(`\n? 判定不可（個別予約0件）: ${unknown.length}件`);
  for (const r of unknown) console.log(`  ${r.lpCr} | 費用 ¥${Math.round(r.totalSpend).toLocaleString()} | オプト ${r.totalCv}件`);
}

main().catch(console.error);
