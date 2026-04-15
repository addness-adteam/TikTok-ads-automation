/**
 * 広告ごとの予算増額タイムライン × CPA推移
 *
 * 各広告について以下を日別で出力:
 * - その日の最終dailyBudget（snapshotのmax）
 * - その日のINCREASE回数（累積増額回数）
 * - その日の実spend・実CV（補正後Metric）・CPA
 *
 * 目的: 増額N回目以降でCPAが高騰するパターンを見つける
 */
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const AI_ACCOUNTS: Record<string, string> = {
  AI_1: '7468288053866561553',
  AI_2: '7523128243466551303',
  AI_3: '7543540647266074641',
  AI_4: '7580666710525493255',
};
const PERIOD_START = new Date('2026-03-25T00:00:00Z');
const PERIOD_END = new Date('2026-04-14T15:00:00Z');

function dayKey(d: Date): string {
  // JST日付
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

async function main() {
  const prisma = new PrismaClient();

  // advertiser mapping
  const advertisers = await prisma.advertiser.findMany({
    where: { tiktokAdvertiserId: { in: Object.values(AI_ACCOUNTS) } },
  });
  const advNameByInternal = new Map<string, string>();
  for (const [name, ttId] of Object.entries(AI_ACCOUNTS)) {
    const a = advertisers.find((x) => x.tiktokAdvertiserId === ttId);
    if (a) advNameByInternal.set(a.id, name);
  }

  // snapshots
  const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      advertiserId: { in: Object.values(AI_ACCOUNTS) },
      executionTime: { gte: PERIOD_START, lt: PERIOD_END },
    },
    orderBy: { executionTime: 'asc' },
  });

  // snaps: adTiktokId → Map<day, {maxBudget, increases, action_last}>
  const snapByAdDay = new Map<string, Map<string, { budget: number; increases: number; maxBudgetToday: number; adName: string }>>();
  for (const s of snaps) {
    const day = dayKey(s.executionTime);
    if (!snapByAdDay.has(s.adId)) snapByAdDay.set(s.adId, new Map());
    const dayMap = snapByAdDay.get(s.adId)!;
    const cur = dayMap.get(day) ?? { budget: 0, increases: 0, maxBudgetToday: 0, adName: s.adName };
    cur.budget = Math.max(cur.budget, s.dailyBudget);
    cur.maxBudgetToday = Math.max(cur.maxBudgetToday, s.newBudget ?? s.dailyBudget);
    if (s.action === 'INCREASE') cur.increases += 1;
    dayMap.set(day, cur);
  }

  // internal ad.id <-> tiktokId
  const ads = await prisma.ad.findMany({
    where: { adGroup: { campaign: { advertiserId: { in: advertisers.map((a) => a.id) } } } },
    include: { adGroup: { include: { campaign: true } } },
  });
  const internalByTiktok = new Map(ads.map((a) => [a.tiktokId, a]));

  // metrics per ad per day (corrected data)
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

  // 出力: 増額≥1回の広告のみ、日次タイムライン
  type Row = { day: string; budget: number; increases: number; todaySpend: number; todayCv: number; todayCpa: number | null; cumIncreases: number };
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
      rows.push({
        day,
        budget: s.maxBudgetToday,
        increases: s.increases,
        todaySpend: ts,
        todayCv: tcv,
        todayCpa: tcv > 0 ? ts / tcv : null,
        cumIncreases: cumInc,
      });
    }
    if (totalInc === 0) continue;
    timelines.push({ adTiktokId, adName, account, totalIncreases: totalInc, rows });
  }

  timelines.sort((a, b) => b.totalIncreases - a.totalIncreases);

  // コンソール出力
  console.log(`\n増額実行があった広告: ${timelines.length}件（期間 ${PERIOD_START.toISOString().slice(0,10)}〜${PERIOD_END.toISOString().slice(0,10)}）\n`);
  for (const t of timelines) {
    console.log('='.repeat(100));
    console.log(`${t.account} | 合計${t.totalIncreases}回増額 | ${t.adName} (${t.adTiktokId})`);
    console.log('-'.repeat(100));
    console.log('date       | 当日予算 | 当日増額 | 累積増額 | 当日spend | 当日CV | 当日CPA');
    for (const r of t.rows) {
      const cpa = r.todayCpa !== null ? `¥${Math.round(r.todayCpa).toLocaleString()}` : '---';
      const marker = r.todayCpa !== null && r.todayCpa > 5000 ? ' 🔥' : (r.todayCv === 0 && r.todaySpend > 1000 ? ' ⚠️CV0' : '');
      console.log(`${r.day} | ¥${Math.round(r.budget).toString().padStart(6)} | ${String(r.increases).padStart(2)}回    | ${String(r.cumIncreases).padStart(2)}回    | ¥${Math.round(r.todaySpend).toString().padStart(7)} | ${String(r.todayCv).padStart(3)}   | ${cpa.padStart(8)}${marker}`);
    }
  }

  // 累積増額回数 → 当日CPA の散布（累積ビン別CPA平均と中央値）
  console.log('\n\n' + '='.repeat(100));
  console.log('【累積増額回数 vs 当日CPA】 (全広告の全日を統合)');
  console.log('='.repeat(100));
  type Point = { cumInc: number; spend: number; cv: number };
  const pts: Point[] = [];
  for (const t of timelines) {
    for (const r of t.rows) {
      if (r.todaySpend < 500) continue;
      pts.push({ cumInc: r.cumIncreases, spend: r.todaySpend, cv: r.todayCv });
    }
  }
  const bins: { label: string; min: number; max: number; spend: number; cv: number; days: number; cpaList: number[] }[] = [
    { label: '累積0回', min: 0, max: 0, spend: 0, cv: 0, days: 0, cpaList: [] },
    { label: '累積1-2', min: 1, max: 2, spend: 0, cv: 0, days: 0, cpaList: [] },
    { label: '累積3-5', min: 3, max: 5, spend: 0, cv: 0, days: 0, cpaList: [] },
    { label: '累積6-10', min: 6, max: 10, spend: 0, cv: 0, days: 0, cpaList: [] },
    { label: '累積11+', min: 11, max: Infinity, spend: 0, cv: 0, days: 0, cpaList: [] },
  ];
  for (const p of pts) {
    const b = bins.find((b) => p.cumInc >= b.min && p.cumInc <= b.max);
    if (!b) continue;
    b.spend += p.spend;
    b.cv += p.cv;
    b.days += 1;
    if (p.cv > 0) b.cpaList.push(p.spend / p.cv);
  }
  console.log('bin       | 日数 | spend    | CV  | 加重CPA  | 中央値CPA | CV0日数');
  for (const b of bins) {
    const weightedCpa = b.cv > 0 ? b.spend / b.cv : 0;
    const sorted = [...b.cpaList].sort((a, b) => a - b);
    const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
    const cv0Days = b.days - b.cpaList.length;
    console.log(`${b.label.padEnd(10)} | ${String(b.days).padStart(4)} | ¥${Math.round(b.spend).toLocaleString().padStart(8)} | ${String(b.cv).padStart(3)} | ¥${Math.round(weightedCpa).toLocaleString().padStart(7)} | ¥${Math.round(median).toLocaleString().padStart(8)} | ${cv0Days}`);
  }

  // CSV
  const csv = ['account,adTiktokId,adName,totalIncreases,date,budget,increasesToday,cumIncreases,spend,cv,cpa'];
  for (const t of timelines) {
    for (const r of t.rows) {
      csv.push(`${t.account},${t.adTiktokId},"${t.adName}",${t.totalIncreases},${r.day},${Math.round(r.budget)},${r.increases},${r.cumIncreases},${Math.round(r.todaySpend)},${r.todayCv},${r.todayCpa !== null ? Math.round(r.todayCpa) : ''}`);
    }
  }
  fs.writeFileSync(path.join(process.cwd(), 'ad-budget-timeline.csv'), csv.join('\n'), 'utf8');
  console.log(`\nCSV: ${path.join(process.cwd(), 'ad-budget-timeline.csv')}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
