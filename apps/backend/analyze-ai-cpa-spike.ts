/**
 * AI導線CPA高騰要因分析（2026-04月次）
 *
 * 軸1: CR重複（同一CRが何アカウントで並走しているか × CPA相関）
 * 軸2: 予算調整V2の1.3倍昇格ログ分析（昇格回数 vs CPA推移）
 * 軸3: 横展開ログ直近、時間帯偏り等の補助指標
 *
 * ※CVはTikTok APIのMetric.conversions（スプシ真値ではないが相対比較用）
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const AI_ACCOUNTS: Record<string, string> = {
  AI_1: '7468288053866561553',
  AI_2: '7523128243466551303',
  AI_3: '7543540647266074641',
  AI_4: '7580666710525493255',
};

const PERIOD_START = new Date('2026-04-01T00:00:00+09:00');
const PERIOD_END = new Date('2026-04-15T00:00:00+09:00');

// CR名抽出（ad_name = YYMMDD/制作者/CR名/LP名）
function extractCR(adName: string): string | null {
  const parts = adName.split('/');
  if (parts.length < 4) return null;
  const cr = parts.slice(2, parts.length - 1).join('/');
  // CRxxxxx形式を優先抽出
  const m = cr.match(/CR\d{4,5}/i);
  return m ? m[0].toUpperCase() : cr;
}

async function main() {
  console.log('='.repeat(80));
  console.log(`AI導線CPA高騰分析 期間: ${PERIOD_START.toISOString()} 〜 ${PERIOD_END.toISOString()}`);
  console.log('='.repeat(80));

  const advertisers = await prisma.advertiser.findMany({
    where: { tiktokAdvertiserId: { in: Object.values(AI_ACCOUNTS) } },
  });
  const advIdByTiktok = new Map(advertisers.map((a) => [a.tiktokAdvertiserId, a.id]));
  const advNameByInternal = new Map<string, string>();
  for (const [name, ttId] of Object.entries(AI_ACCOUNTS)) {
    const internal = advIdByTiktok.get(ttId);
    if (internal) advNameByInternal.set(internal, name);
  }
  console.log(`\n対象Advertiser: ${advertisers.length}件`);

  // --- 広告とAdGroup/Campaignの全件取得（AIアカウントのみ）---
  const ads = await prisma.ad.findMany({
    where: {
      adGroup: {
        campaign: {
          advertiserId: { in: advertisers.map((a) => a.id) },
        },
      },
    },
    include: {
      adGroup: { include: { campaign: true } },
    },
  });
  console.log(`AI配下の広告総数: ${ads.length}件`);

  const adInfoById = new Map<string, { tiktokAdId: string; adName: string; advertiserInternal: string; accountName: string; cr: string | null }>();
  for (const ad of ads) {
    const advInternal = ad.adGroup.campaign.advertiserId;
    const accountName = advNameByInternal.get(advInternal) ?? 'UNKNOWN';
    adInfoById.set(ad.id, {
      tiktokAdId: ad.tiktokId,
      adName: ad.name,
      advertiserInternal: advInternal,
      accountName,
      cr: extractCR(ad.name),
    });
  }

  // --- 当月Metric集計 ---
  const metrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      adId: { in: ads.map((a) => a.id) },
      statDate: { gte: PERIOD_START, lt: PERIOD_END },
    },
  });
  console.log(`当月metric件数: ${metrics.length}`);

  // ad_id -> {spend, cv}
  const perAd = new Map<string, { spend: number; cv: number; impressions: number; days: number }>();
  for (const m of metrics) {
    if (!m.adId) continue;
    const cur = perAd.get(m.adId) ?? { spend: 0, cv: 0, impressions: 0, days: 0 };
    cur.spend += m.spend;
    cur.cv += m.conversions;
    cur.impressions += m.impressions;
    cur.days += 1;
    perAd.set(m.adId, cur);
  }

  // ====== 全体サマリ ======
  console.log('\n' + '='.repeat(80));
  console.log('【0】全体サマリ（アカウント別）');
  console.log('='.repeat(80));
  const acctAgg = new Map<string, { spend: number; cv: number; ads: number }>();
  for (const [adId, info] of adInfoById) {
    const m = perAd.get(adId);
    if (!m || m.spend === 0) continue;
    const cur = acctAgg.get(info.accountName) ?? { spend: 0, cv: 0, ads: 0 };
    cur.spend += m.spend;
    cur.cv += m.cv;
    cur.ads += 1;
    acctAgg.set(info.accountName, cur);
  }
  console.log('account | spend | CV | CPA | 稼働Ad数');
  for (const [name, v] of [...acctAgg.entries()].sort()) {
    const cpa = v.cv > 0 ? v.spend / v.cv : 0;
    console.log(`  ${name} | ¥${v.spend.toFixed(0)} | ${v.cv} | ¥${cpa.toFixed(0)} | ${v.ads}`);
  }

  // ====== 軸1: CR重複分析 ======
  console.log('\n' + '='.repeat(80));
  console.log('【1】CR番号別 稼働アカウント数 × CPA');
  console.log('='.repeat(80));
  const crAgg = new Map<string, { accounts: Set<string>; ads: number; spend: number; cv: number; adNames: string[] }>();
  for (const [adId, info] of adInfoById) {
    if (!info.cr) continue;
    const m = perAd.get(adId);
    if (!m || m.spend < 100) continue; // ノイズ除外
    const cur = crAgg.get(info.cr) ?? { accounts: new Set(), ads: 0, spend: 0, cv: 0, adNames: [] };
    cur.accounts.add(info.accountName);
    cur.ads += 1;
    cur.spend += m.spend;
    cur.cv += m.cv;
    if (cur.adNames.length < 3) cur.adNames.push(`${info.accountName}:${info.adName.substring(0, 40)}`);
    crAgg.set(info.cr, cur);
  }

  // 重複数ごとのCPA平均（加重）
  const byAcctCount = new Map<number, { spend: number; cv: number; crs: number }>();
  for (const [cr, v] of crAgg) {
    const n = v.accounts.size;
    const cur = byAcctCount.get(n) ?? { spend: 0, cv: 0, crs: 0 };
    cur.spend += v.spend;
    cur.cv += v.cv;
    cur.crs += 1;
    byAcctCount.set(n, cur);
  }
  console.log('\n■ 重複アカウント数別 加重CPA（重複が多いほどCPA高いか？）');
  console.log('アカウント数 | CR件数 | 総spend | 総CV | 加重CPA');
  for (const n of [...byAcctCount.keys()].sort()) {
    const v = byAcctCount.get(n)!;
    const cpa = v.cv > 0 ? v.spend / v.cv : 0;
    console.log(`  ${n}アカウント | ${v.crs}件 | ¥${v.spend.toFixed(0)} | ${v.cv} | ¥${cpa.toFixed(0)}`);
  }

  console.log('\n■ TOP10: 消化額大きいCR（重複有無と成績）');
  const sortedCR = [...crAgg.entries()].sort((a, b) => b[1].spend - a[1].spend).slice(0, 15);
  console.log('CR | アカ数 | Ad数 | spend | CV | CPA');
  for (const [cr, v] of sortedCR) {
    const cpa = v.cv > 0 ? v.spend / v.cv : 0;
    console.log(`  ${cr} | ${v.accounts.size} (${[...v.accounts].join(',')}) | ${v.ads} | ¥${v.spend.toFixed(0)} | ${v.cv} | ¥${cpa.toFixed(0)}`);
  }

  // 同一アカウント内での同一CR重複（5種類出す問題）
  console.log('\n■ 同一アカウント内で同一CRに複数Adが存在するケース（5種類問題）');
  const intraDup = new Map<string, Map<string, number>>(); // cr -> (account -> adCount)
  for (const [adId, info] of adInfoById) {
    if (!info.cr) continue;
    const m = perAd.get(adId);
    if (!m || m.spend < 100) continue;
    if (!intraDup.has(info.cr)) intraDup.set(info.cr, new Map());
    const inner = intraDup.get(info.cr)!;
    inner.set(info.accountName, (inner.get(info.accountName) ?? 0) + 1);
  }
  const intraRows: { cr: string; acct: string; count: number }[] = [];
  for (const [cr, m] of intraDup) {
    for (const [acct, cnt] of m) {
      if (cnt >= 2) intraRows.push({ cr, acct, count: cnt });
    }
  }
  intraRows.sort((a, b) => b.count - a.count);
  console.log(`  該当: ${intraRows.length}件`);
  for (const r of intraRows.slice(0, 15)) {
    console.log(`  ${r.cr} | ${r.acct} | ${r.count}広告並走`);
  }

  // ====== 軸2: 予算調整V2分析 ======
  console.log('\n' + '='.repeat(80));
  console.log('【2】予算調整V2（HourlyOptimizationSnapshot）分析');
  console.log('='.repeat(80));
  const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      advertiserId: { in: Object.values(AI_ACCOUNTS) },
      executionTime: { gte: PERIOD_START, lt: PERIOD_END },
    },
    orderBy: { executionTime: 'asc' },
  });
  console.log(`当月snapshot件数: ${snaps.length}`);

  const actionCount = new Map<string, number>();
  for (const s of snaps) {
    actionCount.set(s.action, (actionCount.get(s.action) ?? 0) + 1);
  }
  console.log('\n■ action分布');
  for (const [a, c] of [...actionCount.entries()].sort((x, y) => y[1] - x[1])) {
    console.log(`  ${a}: ${c}`);
  }

  // 増額回数の多いTOP広告
  const incByAd = new Map<string, { count: number; adName: string; totalDeltaBudget: number; maxBudget: number }>();
  for (const s of snaps) {
    const isInc = s.action === 'INCREASE' || s.action.includes('INCREASE') || (s.newBudget != null && s.newBudget > s.dailyBudget);
    if (!isInc) continue;
    const cur = incByAd.get(s.adId) ?? { count: 0, adName: s.adName, totalDeltaBudget: 0, maxBudget: 0 };
    cur.count += 1;
    if (s.newBudget != null) {
      cur.totalDeltaBudget += s.newBudget - s.dailyBudget;
      cur.maxBudget = Math.max(cur.maxBudget, s.newBudget);
    }
    incByAd.set(s.adId, cur);
  }
  console.log(`\n■ 今月の増額実行: ${[...incByAd.values()].reduce((s, v) => s + v.count, 0)}回 / ${incByAd.size}広告`);

  const topInc = [...incByAd.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20);
  console.log('\n■ 増額回数TOP20（昇格やり過ぎ候補）');
  console.log('tiktokAdId | 増額回数 | 最大日予算 | ad名(40字)');
  for (const [adTiktokId, v] of topInc) {
    console.log(`  ${adTiktokId} | ${v.count}回 | ¥${v.maxBudget.toFixed(0)} | ${v.adName.substring(0, 40)}`);
  }

  // 昇格回数 vs 翌日CPAの相関（簡易）
  console.log('\n■ 増額回数ビン別 当月累計CPA（増額多い広告ほどCPA高いか？）');
  // adTiktokId -> 内部ad.id変換
  const internalByTiktok = new Map<string, string>();
  for (const [adId, info] of adInfoById) internalByTiktok.set(info.tiktokAdId, adId);

  const bins = [
    { label: '0回', min: 0, max: 0 },
    { label: '1-2回', min: 1, max: 2 },
    { label: '3-5回', min: 3, max: 5 },
    { label: '6-10回', min: 6, max: 10 },
    { label: '11回以上', min: 11, max: Infinity },
  ];
  const binAgg = bins.map((b) => ({ ...b, spend: 0, cv: 0, ads: 0 }));

  for (const [adId, info] of adInfoById) {
    const m = perAd.get(adId);
    if (!m || m.spend < 1000) continue;
    const incInfo = incByAd.get(info.tiktokAdId);
    const incCount = incInfo?.count ?? 0;
    const bin = binAgg.find((b) => incCount >= b.min && incCount <= b.max);
    if (!bin) continue;
    bin.spend += m.spend;
    bin.cv += m.cv;
    bin.ads += 1;
  }
  console.log('増額回数 | Ad数 | spend | CV | 加重CPA');
  for (const b of binAgg) {
    const cpa = b.cv > 0 ? b.spend / b.cv : 0;
    console.log(`  ${b.label} | ${b.ads} | ¥${b.spend.toFixed(0)} | ${b.cv} | ¥${cpa.toFixed(0)}`);
  }

  // ====== 軸3補助: 横展開ログ直近 ======
  console.log('\n' + '='.repeat(80));
  console.log('【3】横展開ログ（当月分）');
  console.log('='.repeat(80));
  const cdLogs = await prisma.crossDeployLog.findMany({
    where: {
      targetAdvertiserId: { in: Object.values(AI_ACCOUNTS) },
      createdAt: { gte: PERIOD_START, lt: PERIOD_END },
    },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`当月横展開: ${cdLogs.length}件（target=AI配下）`);
  const byTarget = new Map<string, number>();
  for (const log of cdLogs) {
    byTarget.set(log.targetAdvertiserId, (byTarget.get(log.targetAdvertiserId) ?? 0) + 1);
  }
  for (const [tt, c] of byTarget) {
    const name = Object.entries(AI_ACCOUNTS).find(([, v]) => v === tt)?.[0] ?? tt;
    console.log(`  ${name}: ${c}件`);
  }

  // 横展開直後の赤字（ad作成後7日以内の消化 vs CV）
  console.log('\n■ 横展開で作成された広告の立ち上がり成績（作成後の今月消化全体）');
  const cdAdTiktokIds = cdLogs.map((l) => l.adId).filter(Boolean) as string[];
  let cdSpend = 0;
  let cdCv = 0;
  let cdAdsWithSpend = 0;
  for (const ttId of cdAdTiktokIds) {
    const internal = internalByTiktok.get(ttId);
    if (!internal) continue;
    const m = perAd.get(internal);
    if (!m || m.spend === 0) continue;
    cdSpend += m.spend;
    cdCv += m.cv;
    cdAdsWithSpend += 1;
  }
  const cdCpa = cdCv > 0 ? cdSpend / cdCv : 0;
  console.log(`  横展開広告 稼働${cdAdsWithSpend} | spend ¥${cdSpend.toFixed(0)} | CV ${cdCv} | CPA ¥${cdCpa.toFixed(0)}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
