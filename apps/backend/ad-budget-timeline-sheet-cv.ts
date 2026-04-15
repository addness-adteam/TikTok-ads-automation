/**
 * 広告ごとの予算増額タイムライン × CPO推移 (スプシCV版)
 *
 * ad-budget-timeline.ts と同じ構造だが、CVの取得元を
 * DB Metric (m.conversions) から UTAGE個別予約スプシに変更。
 *
 * マッチング戦略:
 *   - 広告名から LP\d+-CR\d+ を抽出 (extractLPCR)
 *   - スプシの「登録経路」列からも同じパターンを抽出
 *   - (LP-CR, JST日付) 単位で個別予約数を集計
 *   - 同一(LP-CR, day)に複数広告がある場合、広告費比で按分
 *
 * spend/impressions は DB Metric のまま。
 */
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { google } = require('googleapis');

const AI_ACCOUNTS: Record<string, string> = {
  AI_1: '7468288053866561553',
  AI_2: '7523128243466551303',
  AI_3: '7543540647266074641',
  AI_4: '7580666710525493255',
};
const PERIOD_START = new Date('2026-03-25T00:00:00Z');
const PERIOD_END = new Date('2026-04-14T15:00:00Z');

const INDIVIDUAL_RESERVATION_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';
const AI_SHEET_CONFIG = { sheetName: 'AI', dateCol: 0, pathCol: 46 };

function dayKeyJst(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function extractLPCR(adName: string): string | null {
  const m = adName.match(/(LP\d+-CR\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

function extractCR(adName: string): string | null {
  const m = adName.match(/(CR\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * UTAGE個別予約シート(AI)から (LP-CR, JST日付) 別の個別予約数を集計
 * 期間内のみ
 */
async function getSheetCvByLpCrDay(
  periodStartJst: string,
  periodEndJst: string,
): Promise<Map<string, Map<string, number>>> {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: INDIVIDUAL_RESERVATION_SHEET_ID,
    range: `${AI_SHEET_CONFIG.sheetName}!A:AZ`,
  });
  const rows: any[][] = res.data.values || [];
  // lpCr -> day -> count
  const result = new Map<string, Map<string, number>>();
  let total = 0;
  let inPeriod = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateStr = String(row[AI_SHEET_CONFIG.dateCol] || '').trim();
    const pathValue = row[AI_SHEET_CONFIG.pathCol];
    if (!dateStr || !pathValue) continue;
    const m = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (!m) continue;
    const y = parseInt(m[1]);
    const mo = parseInt(m[2]);
    const d = parseInt(m[3]);
    const dayStr = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    total++;
    if (dayStr < periodStartJst || dayStr > periodEndJst) continue;
    const lines = String(pathValue).split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const lpCrMatch = trimmed.match(/(LP\d+-CR\d+)/i);
      if (!lpCrMatch) continue;
      const lpCr = lpCrMatch[1].toUpperCase();
      // AIシート自体がAI導線専用なので、AIキーワード追加フィルタは不要
      let inner = result.get(lpCr);
      if (!inner) { inner = new Map(); result.set(lpCr, inner); }
      inner.set(dayStr, (inner.get(dayStr) || 0) + 1);
      inPeriod++;
      break; // 1行に複数LP-CRがあっても代表1つだけ
    }
  }
  console.log(`  スプシ総行数: ${rows.length - 1}, 日付パース可: ${total}, 期間内AI予約: ${inPeriod}`);
  return result;
}

async function main() {
  const prisma = new PrismaClient();

  const periodStartJst = dayKeyJst(PERIOD_START);
  const periodEndJst = dayKeyJst(PERIOD_END);

  // --- 1. スプシCV ---
  console.log('=== スプシ個別予約読み込み ===');
  const sheetCvByLpCrDay = await getSheetCvByLpCrDay(periodStartJst, periodEndJst);
  let sumSheetCv = 0;
  for (const inner of sheetCvByLpCrDay.values()) for (const v of inner.values()) sumSheetCv += v;
  console.log(`  期間内 AI個別予約合計 (LP-CR抽出可): ${sumSheetCv}件 / LP-CR種類: ${sheetCvByLpCrDay.size}\n`);

  // --- 2. DB side ---
  const advertisers = await prisma.advertiser.findMany({
    where: { tiktokAdvertiserId: { in: Object.values(AI_ACCOUNTS) } },
  });
  const advNameByInternal = new Map<string, string>();
  for (const [name, ttId] of Object.entries(AI_ACCOUNTS)) {
    const a = advertisers.find((x) => x.tiktokAdvertiserId === ttId);
    if (a) advNameByInternal.set(a.id, name);
  }

  const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      advertiserId: { in: Object.values(AI_ACCOUNTS) },
      executionTime: { gte: PERIOD_START, lt: PERIOD_END },
    },
    orderBy: { executionTime: 'asc' },
  });

  const snapByAdDay = new Map<string, Map<string, { budget: number; increases: number; maxBudgetToday: number; adName: string }>>();
  for (const s of snaps) {
    const day = dayKeyJst(s.executionTime);
    if (!snapByAdDay.has(s.adId)) snapByAdDay.set(s.adId, new Map());
    const dayMap = snapByAdDay.get(s.adId)!;
    const cur = dayMap.get(day) ?? { budget: 0, increases: 0, maxBudgetToday: 0, adName: s.adName };
    cur.budget = Math.max(cur.budget, s.dailyBudget);
    cur.maxBudgetToday = Math.max(cur.maxBudgetToday, s.newBudget ?? s.dailyBudget);
    if (s.action === 'INCREASE') cur.increases += 1;
    dayMap.set(day, cur);
  }

  const ads = await prisma.ad.findMany({
    where: { adGroup: { campaign: { advertiserId: { in: advertisers.map((a) => a.id) } } } },
    include: { adGroup: { include: { campaign: true } } },
  });
  const internalByTiktok = new Map(ads.map((a) => [a.tiktokId, a]));

  const metrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      adId: { in: ads.map((a) => a.id) },
      statDate: { gte: PERIOD_START, lt: PERIOD_END },
    },
  });
  const metByAdDay = new Map<string, Map<string, { spend: number; cv: number; imp: number }>>();
  for (const m of metrics) {
    if (!m.adId) continue;
    const day = m.statDate.toISOString().slice(0, 10);
    if (!metByAdDay.has(m.adId)) metByAdDay.set(m.adId, new Map());
    const dayMap = metByAdDay.get(m.adId)!;
    const cur = dayMap.get(day) ?? { spend: 0, cv: 0, imp: 0 };
    cur.spend += m.spend;
    cur.cv += m.conversions;
    cur.imp += m.impressions;
    dayMap.set(day, cur);
  }

  // --- 3. 各日ごとに (LP-CR, day) の総spendを算出し、広告別にCVを按分 ---
  // step a: 対象となる全ad内部ID → LP-CR
  const lpCrByAdInternalId = new Map<string, string>();
  for (const a of ads) {
    const lpCr = extractLPCR(a.name);
    if (lpCr) lpCrByAdInternalId.set(a.id, lpCr);
  }

  // step b: (lpCr, day) -> totalSpend  (timeline対象広告だけでなくAI配下全広告)
  const spendByLpCrDay = new Map<string, Map<string, number>>();
  for (const [adInternalId, dayMap] of metByAdDay) {
    const lpCr = lpCrByAdInternalId.get(adInternalId);
    if (!lpCr) continue;
    let inner = spendByLpCrDay.get(lpCr);
    if (!inner) { inner = new Map(); spendByLpCrDay.set(lpCr, inner); }
    for (const [day, m] of dayMap) {
      inner.set(day, (inner.get(day) || 0) + m.spend);
    }
  }

  // step c: 広告別・日別 sheetCV = groupCV * (adSpend / groupSpend)
  function allocateSheetCv(adInternalId: string, day: string): number {
    const lpCr = lpCrByAdInternalId.get(adInternalId);
    if (!lpCr) return 0;
    const groupCv = sheetCvByLpCrDay.get(lpCr)?.get(day) || 0;
    if (groupCv === 0) return 0;
    const groupSpend = spendByLpCrDay.get(lpCr)?.get(day) || 0;
    const adSpend = metByAdDay.get(adInternalId)?.get(day)?.spend || 0;
    if (groupSpend <= 0 || adSpend <= 0) return 0;
    return groupCv * (adSpend / groupSpend);
  }

  // --- 4. timeline 構築 ---
  type Row = { day: string; budget: number; increases: number; todaySpend: number; todayCv: number; sheetCv: number; todayCpa: number | null; sheetCpo: number | null; cumIncreases: number };
  type AdTimeline = { adTiktokId: string; adName: string; account: string; totalIncreases: number; rows: Row[] };
  const timelines: AdTimeline[] = [];

  for (const [adTiktokId, dayMap] of snapByAdDay) {
    const ad = internalByTiktok.get(adTiktokId);
    if (!ad) continue;
    const account = advNameByInternal.get(ad.adGroup.campaign.advertiserId) ?? '?';
    const adName = ad.name;

    const days = [...dayMap.keys()].sort();
    const rows: Row[] = [];
    let cumInc = 0;
    let totalInc = 0;
    for (const day of days) {
      const s = dayMap.get(day)!;
      cumInc += s.increases;
      totalInc += s.increases;
      const met = metByAdDay.get(ad.id)?.get(day);
      const ts = met?.spend ?? 0;
      const tcv = met?.cv ?? 0;
      const scv = allocateSheetCv(ad.id, day);
      rows.push({
        day,
        budget: s.maxBudgetToday,
        increases: s.increases,
        todaySpend: ts,
        todayCv: tcv,
        sheetCv: scv,
        todayCpa: tcv > 0 ? ts / tcv : null,
        sheetCpo: scv > 0 ? ts / scv : null,
        cumIncreases: cumInc,
      });
    }
    if (totalInc === 0) continue;
    timelines.push({ adTiktokId, adName, account, totalIncreases: totalInc, rows });
  }
  timelines.sort((a, b) => b.totalIncreases - a.totalIncreases);

  console.log(`増額実行があった広告: ${timelines.length}件（期間 ${periodStartJst}〜${periodEndJst}）\n`);

  // --- 5. 上位15広告の比較テーブル ---
  console.log('='.repeat(110));
  console.log('【上位15広告 (増額回数順) - スプシCV基準 vs TikTok CV】');
  console.log('='.repeat(110));
  console.log('account | inc | adName                                          | spend      | sheetCV | sheetCPO | tiktokCV | tiktokCPO');
  console.log('-'.repeat(110));
  for (const t of timelines.slice(0, 15)) {
    const spend = t.rows.reduce((s, r) => s + r.todaySpend, 0);
    const sheetCv = t.rows.reduce((s, r) => s + r.sheetCv, 0);
    const ttCv = t.rows.reduce((s, r) => s + r.todayCv, 0);
    const sheetCpo = sheetCv > 0 ? spend / sheetCv : null;
    const ttCpo = ttCv > 0 ? spend / ttCv : null;
    const nameShort = t.adName.length > 48 ? t.adName.slice(0, 45) + '...' : t.adName.padEnd(48);
    console.log(
      `${t.account.padEnd(5)} | ${String(t.totalIncreases).padStart(3)} | ${nameShort} | ¥${Math.round(spend).toLocaleString().padStart(9)} | ${sheetCv.toFixed(2).padStart(7)} | ${sheetCpo !== null ? ('¥' + Math.round(sheetCpo).toLocaleString()).padStart(8) : '     ---'} | ${String(ttCv).padStart(8)} | ${ttCpo !== null ? ('¥' + Math.round(ttCpo).toLocaleString()).padStart(9) : '      ---'}`,
    );
  }

  // --- 6. 累積増額ビンごとの加重CPO/中央値CPO (sheetCV基準) ---
  console.log('\n' + '='.repeat(100));
  console.log('【累積増額回数 vs 当日CPO (スプシCV基準)】');
  console.log('='.repeat(100));
  const bins: { label: string; min: number; max: number; spend: number; cv: number; days: number; cpoList: number[] }[] = [
    { label: '累積0回', min: 0, max: 0, spend: 0, cv: 0, days: 0, cpoList: [] },
    { label: '累積1-2', min: 1, max: 2, spend: 0, cv: 0, days: 0, cpoList: [] },
    { label: '累積3-5', min: 3, max: 5, spend: 0, cv: 0, days: 0, cpoList: [] },
    { label: '累積6-10', min: 6, max: 10, spend: 0, cv: 0, days: 0, cpoList: [] },
    { label: '累積11+', min: 11, max: Infinity, spend: 0, cv: 0, days: 0, cpoList: [] },
  ];
  for (const t of timelines) {
    for (const r of t.rows) {
      if (r.todaySpend < 500) continue;
      const b = bins.find((b) => r.cumIncreases >= b.min && r.cumIncreases <= b.max);
      if (!b) continue;
      b.spend += r.todaySpend;
      b.cv += r.sheetCv;
      b.days += 1;
      if (r.sheetCv > 0) b.cpoList.push(r.todaySpend / r.sheetCv);
    }
  }
  console.log('bin       | 日数 | spend      | sheetCV | 加重CPO   | 中央値CPO | CV0日数');
  for (const b of bins) {
    const weighted = b.cv > 0 ? b.spend / b.cv : 0;
    const sorted = [...b.cpoList].sort((x, y) => x - y);
    const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
    const cv0Days = b.days - b.cpoList.length;
    console.log(`${b.label.padEnd(10)} | ${String(b.days).padStart(4)} | ¥${Math.round(b.spend).toLocaleString().padStart(9)} | ${b.cv.toFixed(2).padStart(7)} | ¥${Math.round(weighted).toLocaleString().padStart(8)} | ¥${Math.round(median).toLocaleString().padStart(8)} | ${cv0Days}`);
  }

  // --- 7. 同日5回以上INCREASEの暴走広告 ---
  console.log('\n' + '='.repeat(100));
  console.log('【同日5回以上INCREASE (暴走) の実CPO - スプシCV基準】');
  console.log('='.repeat(100));
  console.log('account | date       | inc | spend      | sheetCV | sheetCPO   | tiktokCV | adName');
  for (const t of timelines) {
    for (const r of t.rows) {
      if (r.increases < 5) continue;
      const nameShort = t.adName.length > 40 ? t.adName.slice(0, 37) + '...' : t.adName;
      console.log(
        `${t.account.padEnd(5)} | ${r.day} | ${String(r.increases).padStart(3)} | ¥${Math.round(r.todaySpend).toLocaleString().padStart(9)} | ${r.sheetCv.toFixed(2).padStart(7)} | ${r.sheetCpo !== null ? ('¥' + Math.round(r.sheetCpo).toLocaleString()).padStart(10) : '       ---'} | ${String(r.todayCv).padStart(8)} | ${nameShort}`,
      );
    }
  }

  // --- 8. 4/9 CR01159 と 4/12-13 CR01170 の実CPO ---
  console.log('\n' + '='.repeat(100));
  console.log('【注目CR: 4/9 CR01159 / 4/12-13 CR01170】');
  console.log('='.repeat(100));
  const focusCases: { day: string; cr: string }[] = [
    { day: '2026-04-09', cr: 'CR01159' },
    { day: '2026-04-12', cr: 'CR01170' },
    { day: '2026-04-13', cr: 'CR01170' },
  ];
  for (const fc of focusCases) {
    console.log(`\n--- ${fc.day} / ${fc.cr} ---`);
    let found = false;
    for (const t of timelines) {
      const crInName = extractCR(t.adName);
      if (crInName !== fc.cr) continue;
      const r = t.rows.find((x) => x.day === fc.day);
      if (!r) continue;
      found = true;
      console.log(
        `  ${t.account} | ${t.adName} | inc=${r.increases} (cum ${r.cumIncreases}) | spend=¥${Math.round(r.todaySpend).toLocaleString()} | sheetCV=${r.sheetCv.toFixed(2)} | sheetCPO=${r.sheetCpo !== null ? '¥' + Math.round(r.sheetCpo).toLocaleString() : '---'} | tiktokCV=${r.todayCv}`,
      );
    }
    if (!found) console.log('  該当広告なし（増額なしまたは期間外）');
    // timelineに出ない広告（増額0回）もチェック
    for (const ad of ads) {
      if (extractCR(ad.name) !== fc.cr) continue;
      if (timelines.some((t) => t.adTiktokId === ad.tiktokId)) continue;
      const met = metByAdDay.get(ad.id)?.get(fc.day);
      if (!met || met.spend <= 0) continue;
      const account = advNameByInternal.get(ad.adGroup.campaign.advertiserId) ?? '?';
      const scv = allocateSheetCv(ad.id, fc.day);
      const cpo = scv > 0 ? met.spend / scv : null;
      console.log(`  (増額0) ${account} | ${ad.name} | spend=¥${Math.round(met.spend).toLocaleString()} | sheetCV=${scv.toFixed(2)} | sheetCPO=${cpo !== null ? '¥' + Math.round(cpo).toLocaleString() : '---'} | tiktokCV=${met.cv}`);
    }
  }

  // --- 9. CSV ---
  const csv = ['account,adTiktokId,adName,totalIncreases,date,budget,increasesToday,cumIncreases,spend,tiktokCv,tiktokCpa,sheetCv,sheetCpo'];
  for (const t of timelines) {
    for (const r of t.rows) {
      csv.push(
        `${t.account},${t.adTiktokId},"${t.adName.replace(/"/g, '""')}",${t.totalIncreases},${r.day},${Math.round(r.budget)},${r.increases},${r.cumIncreases},${Math.round(r.todaySpend)},${r.todayCv},${r.todayCpa !== null ? Math.round(r.todayCpa) : ''},${r.sheetCv.toFixed(4)},${r.sheetCpo !== null ? Math.round(r.sheetCpo) : ''}`,
      );
    }
  }
  const outPath = path.join(process.cwd(), 'ad-budget-timeline-sheet-cv.csv');
  fs.writeFileSync(outPath, csv.join('\n'), 'utf8');
  console.log(`\nCSV: ${outPath}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
