/**
 * 70CV/日超えの共通点分析（AI導線スマプラ限定）
 * 70CV超え日 vs 70CV未満日の変数比較で、時間帯以外の共通因子を洗い出す
 *
 * npx tsx apps/backend/analyze-70cv-factors.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

// AI導線のみ
const ACCOUNTS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
  { id: '7580666710525493255', name: 'AI_4' },
];

function jstDate(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')}`;
}

async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

interface CampDay {
  date: string; accountName: string; campaignId: string;
  cv: number; spend: number; impressions: number; clicks: number;
  cpa: number; cpc: number; ctr: number;
  videoViews6s: number; videoViews2s: number;
}

interface CampMeta {
  name: string; account: string;
  creativeCount: number; isSmart: boolean;
  targeting: string; ageGroups: string[]; dfToggle: string;
  dfEvent: string; placements: string[];
  campaignBudgetMode: string; campaignBudget: number;
  adGroupBudget: number;
  createdDate: string; // 広告名から抽出 YYMMDD
}

async function main() {
  const now = new Date();
  const endDate = jstDate(now);
  // 30日制限があるので2期間に分けて取得（合計60日）
  const midDate = jstDate(new Date(now.getTime() - 29 * 86400000));
  const startDate = jstDate(new Date(now.getTime() - 59 * 86400000));
  const periods = [
    { start: startDate, end: midDate },
    { start: addDays(midDate, 1), end: endDate },
  ];

  console.log(`=== 70CV超え共通点分析（AI導線スマプラ）===`);
  console.log(`期間: ${startDate} 〜 ${endDate}\n`);

  // STEP 1: 全キャンペーン日別データ取得
  console.log('STEP 1: 日別データ取得...');
  const allDays: CampDay[] = [];
  const allCampaignIds = new Set<string>();

  for (const acc of ACCOUNTS) {
    process.stdout.write(`  ${acc.name}...`);
    let count = 0;
    for (const period of periods) {
      let page = 1;
      while (true) {
        const resp = await get('/v1.3/report/integrated/get/', {
          advertiser_id: acc.id, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
          dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
          metrics: JSON.stringify(['spend', 'conversion', 'impressions', 'clicks', 'cpc', 'ctr', 'cost_per_conversion',
            'video_watched_2s', 'video_watched_6s']),
          start_date: period.start, end_date: period.end, page_size: '1000', page: String(page),
        });
        if (resp.code !== 0) { console.log(` エラー(${period.start}〜): ${resp.message}`); break; }
        const list = resp.data?.list || [];
        for (const row of list) {
          const spend = parseFloat(row.metrics?.spend || '0');
          if (spend < 100) continue;
          const campId = row.dimensions?.campaign_id;
          allCampaignIds.add(campId);
          allDays.push({
            date: row.dimensions?.stat_time_day?.split(' ')[0] || '',
            accountName: acc.name, campaignId: campId,
            cv: parseInt(row.metrics?.conversion || '0'),
            spend, impressions: parseInt(row.metrics?.impressions || '0'),
            clicks: parseInt(row.metrics?.clicks || '0'),
            cpa: parseFloat(row.metrics?.cost_per_conversion || '0'),
            cpc: parseFloat(row.metrics?.cpc || '0'),
            ctr: parseFloat(row.metrics?.ctr || '0'),
            videoViews2s: parseInt(row.metrics?.video_watched_2s || '0'),
            videoViews6s: parseInt(row.metrics?.video_watched_6s || '0'),
          });
          count++;
        }
        if (list.length < 1000) break;
        page++;
      }
    }
    console.log(` ${count}行`);
  }

  // STEP 2: キャンペーンメタ情報取得
  console.log('\nSTEP 2: キャンペーン詳細取得...');
  const campMeta = new Map<string, CampMeta>();

  for (const acc of ACCOUNTS) {
    const ids = [...allCampaignIds].filter(id =>
      allDays.some(d => d.campaignId === id && d.accountName === acc.name));
    if (ids.length === 0) continue;
    process.stdout.write(`  ${acc.name}...`);

    // キャンペーン情報
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const cr = await get('/v1.3/campaign/get/', {
        advertiser_id: acc.id,
        filtering: JSON.stringify({ campaign_ids: batch }),
        fields: JSON.stringify(['campaign_id', 'campaign_name', 'budget', 'budget_mode']),
        page_size: '100',
      });
      for (const c of cr.data?.list || []) {
        // 広告名から作成日抽出
        const dateMatch = c.campaign_name?.match(/(\d{6})/);
        campMeta.set(c.campaign_id, {
          name: c.campaign_name, account: acc.name,
          creativeCount: 0, isSmart: false,
          targeting: '不明', ageGroups: [], dfToggle: 'OFF', dfEvent: '',
          placements: [], campaignBudgetMode: c.budget_mode || '', campaignBudget: c.budget || 0,
          adGroupBudget: 0, createdDate: dateMatch ? dateMatch[1] : '',
        });
      }
    }

    // Smart+広告グループ
    let agPage = 1;
    while (true) {
      const agR = await get('/v1.3/smart_plus/adgroup/get/', { advertiser_id: acc.id, page_size: '100', page: String(agPage) });
      if (agR.code !== 0) break;
      for (const ag of agR.data?.list || []) {
        const ci = campMeta.get(ag.campaign_id);
        if (ci) {
          ci.targeting = ag.targeting_optimization_mode || 'AUTOMATIC';
          ci.ageGroups = ag.targeting_spec?.age_groups || [];
          ci.dfToggle = ag.deep_funnel_toggle || 'OFF';
          ci.dfEvent = ag.deep_funnel_optimization_event || '';
          ci.placements = ag.placements || [];
          ci.adGroupBudget = ag.budget || 0;
        }
      }
      if ((agR.data?.list || []).length < 100) break;
      agPage++;
    }

    // Smart+広告（CR数）
    let adPage = 1;
    while (true) {
      const adR = await get('/v1.3/smart_plus/ad/get/', {
        advertiser_id: acc.id,
        fields: JSON.stringify(['smart_plus_ad_id', 'campaign_id', 'creative_list']),
        page_size: '100', page: String(adPage),
      });
      if (adR.code !== 0) break;
      for (const ad of adR.data?.list || []) {
        const ci = campMeta.get(ad.campaign_id);
        if (ci) { ci.creativeCount += (ad.creative_list?.length || 0); ci.isSmart = true; }
      }
      if ((adR.data?.list || []).length < 100) break;
      adPage++;
    }
    console.log(' OK');
  }

  // Smart+キャンペーンのみフィルタ
  const smartDays = allDays.filter(d => campMeta.get(d.campaignId)?.isSmart);
  console.log(`\nSmart+キャンペーン日別レコード: ${smartDays.length}件`);

  // STEP 3: 70CV超え vs 未満に分割
  const over70 = smartDays.filter(d => d.cv >= 70);
  const under70 = smartDays.filter(d => d.cv < 70 && d.cv >= 5); // 5CV未満はノイズ

  console.log(`70CV超え: ${over70.length}件`);
  console.log(`5〜69CV: ${under70.length}件\n`);

  // 70CV超えが少なすぎる場合は閾値を下げて追加分析
  if (over70.length <= 3) {
    console.log(`\n70CV超えが${over70.length}件のみ。閾値を下げて追加分析します。`);
    // 閾値を段階的に下げて、十分なサンプルがある閾値で分析
    for (const t of [50, 30, 20]) {
      const overT = smartDays.filter(d => d.cv >= t);
      const underT = smartDays.filter(d => d.cv < t && d.cv >= 5);
      console.log(`${t}CV超え: ${overT.length}件`);
      if (overT.length >= 3) {
        analyzeFactors(overT, underT, campMeta, t);
        return;
      }
    }
    // どの閾値でも3件未満の場合、TOP20を表示
    console.log('\nCV数TOP20:');
    smartDays.sort((a, b) => b.cv - a.cv);
    for (const d of smartDays.slice(0, 20)) {
      const ci = campMeta.get(d.campaignId);
      console.log(`  ${d.date} | ${d.accountName} | ${d.cv}CV | CPA ¥${Math.round(d.cpa).toLocaleString()} | CR${ci?.creativeCount}本 | ${ci?.targeting} | DF:${ci?.dfToggle} | ${ci?.name}`);
    }
    return;
  }

  analyzeFactors(over70, under70, campMeta, 70);
}

function analyzeFactors(high: CampDay[], low: CampDay[], meta: Map<string, CampMeta>, threshold: number) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${threshold}CV超え日の共通点分析`);
  console.log(`${'='.repeat(60)}\n`);

  // ---- 一覧表示 ----
  console.log(`【${threshold}CV超え 全件一覧】`);
  high.sort((a, b) => b.cv - a.cv);
  for (const d of high) {
    const ci = meta.get(d.campaignId);
    const tgt = ci?.targeting === 'MANUAL'
      ? `手動(${ci.ageGroups.map(g => g.replace('AGE_', '').replace(/_/g, '-')).join(',')})`
      : 'ノンタゲ';
    const dow = ['日', '月', '火', '水', '木', '金', '土'][new Date(d.date).getDay()];
    const age = ci?.createdDate ? daysSince(ci.createdDate, d.date) : '?';
    console.log(`  ${d.date}(${dow}) | ${d.accountName} | ${d.cv}CV | CPA ¥${Math.round(d.cpa).toLocaleString()} | CPC ¥${Math.round(d.cpc)} | CTR ${(d.ctr * 100).toFixed(2)}% | imp ${d.impressions.toLocaleString()} | 費用 ¥${Math.round(d.spend).toLocaleString()}`);
    console.log(`    CR${ci?.creativeCount}本 | ${tgt} | DF:${ci?.dfToggle}(${ci?.dfEvent || '-'}) | 経過${age}日 | ${ci?.name}`);
  }

  // ---- 比較分析 ----
  console.log(`\n\n【変数別比較: ${threshold}CV超え vs 未満】\n`);

  // 1. CPA
  const highCpa = avg(high.map(d => d.cpa));
  const lowCpa = avg(low.map(d => d.cpa));
  console.log(`■ CPA`);
  console.log(`  ${threshold}CV超え: 平均 ¥${Math.round(highCpa).toLocaleString()} / 中央値 ¥${Math.round(median(high.map(d => d.cpa))).toLocaleString()}`);
  console.log(`  ${threshold}CV未満: 平均 ¥${Math.round(lowCpa).toLocaleString()} / 中央値 ¥${Math.round(median(low.map(d => d.cpa))).toLocaleString()}`);

  // 2. CPC
  console.log(`\n■ CPC`);
  console.log(`  ${threshold}CV超え: 平均 ¥${Math.round(avg(high.map(d => d.cpc)))} / 中央値 ¥${Math.round(median(high.map(d => d.cpc)))}`);
  console.log(`  ${threshold}CV未満: 平均 ¥${Math.round(avg(low.map(d => d.cpc)))} / 中央値 ¥${Math.round(median(low.map(d => d.cpc)))}`);

  // 3. CTR
  console.log(`\n■ CTR`);
  console.log(`  ${threshold}CV超え: 平均 ${(avg(high.map(d => d.ctr)) * 100).toFixed(2)}% / 中央値 ${(median(high.map(d => d.ctr)) * 100).toFixed(2)}%`);
  console.log(`  ${threshold}CV未満: 平均 ${(avg(low.map(d => d.ctr)) * 100).toFixed(2)}% / 中央値 ${(median(low.map(d => d.ctr)) * 100).toFixed(2)}%`);

  // 4. インプレッション
  console.log(`\n■ インプレッション`);
  console.log(`  ${threshold}CV超え: 平均 ${Math.round(avg(high.map(d => d.impressions))).toLocaleString()} / 中央値 ${Math.round(median(high.map(d => d.impressions))).toLocaleString()}`);
  console.log(`  ${threshold}CV未満: 平均 ${Math.round(avg(low.map(d => d.impressions))).toLocaleString()} / 中央値 ${Math.round(median(low.map(d => d.impressions))).toLocaleString()}`);

  // 5. 費用
  console.log(`\n■ 日次費用`);
  console.log(`  ${threshold}CV超え: 平均 ¥${Math.round(avg(high.map(d => d.spend))).toLocaleString()} / 中央値 ¥${Math.round(median(high.map(d => d.spend))).toLocaleString()}`);
  console.log(`  ${threshold}CV未満: 平均 ¥${Math.round(avg(low.map(d => d.spend))).toLocaleString()} / 中央値 ¥${Math.round(median(low.map(d => d.spend))).toLocaleString()}`);

  // 6. CVR（クリック→CV）
  console.log(`\n■ CVR（クリック→CV）`);
  const highCvr = high.map(d => d.clicks > 0 ? d.cv / d.clicks : 0);
  const lowCvr = low.map(d => d.clicks > 0 ? d.cv / d.clicks : 0);
  console.log(`  ${threshold}CV超え: 平均 ${(avg(highCvr) * 100).toFixed(2)}% / 中央値 ${(median(highCvr) * 100).toFixed(2)}%`);
  console.log(`  ${threshold}CV未満: 平均 ${(avg(lowCvr) * 100).toFixed(2)}% / 中央値 ${(median(lowCvr) * 100).toFixed(2)}%`);

  // 7. 6秒視聴率（imp比）
  console.log(`\n■ 6秒視聴率（imp比）`);
  const high6s = high.map(d => d.impressions > 0 ? d.videoViews6s / d.impressions : 0);
  const low6s = low.map(d => d.impressions > 0 ? d.videoViews6s / d.impressions : 0);
  console.log(`  ${threshold}CV超え: 平均 ${(avg(high6s) * 100).toFixed(2)}% / 中央値 ${(median(high6s) * 100).toFixed(2)}%`);
  console.log(`  ${threshold}CV未満: 平均 ${(avg(low6s) * 100).toFixed(2)}% / 中央値 ${(median(low6s) * 100).toFixed(2)}%`);

  // 8. アカウント別分布
  console.log(`\n■ アカウント別`);
  const highByAcc = groupBy(high, d => d.accountName);
  const lowByAcc = groupBy(low, d => d.accountName);
  for (const acc of ['AI_1', 'AI_2', 'AI_3', 'AI_4']) {
    const hc = highByAcc.get(acc)?.length || 0;
    const lc = lowByAcc.get(acc)?.length || 0;
    const total = hc + lc;
    const rate = total > 0 ? (hc / total * 100).toFixed(1) : '0';
    console.log(`  ${acc}: ${threshold}超え ${hc}回 / 全${total}回 (${rate}%)`);
  }

  // 9. CR数別
  console.log(`\n■ CR（クリエイティブ）数`);
  const highCr = high.map(d => meta.get(d.campaignId)?.creativeCount || 0).filter(c => c > 0);
  const lowCr = low.map(d => meta.get(d.campaignId)?.creativeCount || 0).filter(c => c > 0);
  console.log(`  ${threshold}CV超え: 平均 ${avg(highCr).toFixed(1)}本 / 中央値 ${median(highCr)}本 / 範囲 ${Math.min(...highCr)}〜${Math.max(...highCr)}本`);
  console.log(`  ${threshold}CV未満: 平均 ${avg(lowCr).toFixed(1)}本 / 中央値 ${median(lowCr)}本 / 範囲 ${Math.min(...lowCr)}〜${Math.max(...lowCr)}本`);

  // CR数バケット別の超え率
  const crBuckets = [[1, 2], [3, 5], [6, 10], [11, 20], [21, 999]];
  for (const [lo, hi] of crBuckets) {
    const hc = high.filter(d => { const c = meta.get(d.campaignId)?.creativeCount || 0; return c >= lo && c <= hi; }).length;
    const lc = low.filter(d => { const c = meta.get(d.campaignId)?.creativeCount || 0; return c >= lo && c <= hi; }).length;
    const total = hc + lc;
    if (total > 0) {
      console.log(`    CR ${lo}-${hi}本: ${threshold}超え ${hc}回/${total}回 (${(hc / total * 100).toFixed(1)}%)`);
    }
  }

  // 10. ターゲティング
  console.log(`\n■ ターゲティング`);
  const highByTgt = groupBy(high, d => meta.get(d.campaignId)?.targeting || '不明');
  const lowByTgt = groupBy(low, d => meta.get(d.campaignId)?.targeting || '不明');
  for (const tgt of ['MANUAL', 'AUTOMATIC', '不明']) {
    const hc = highByTgt.get(tgt)?.length || 0;
    const lc = lowByTgt.get(tgt)?.length || 0;
    const total = hc + lc;
    if (total > 0) {
      console.log(`  ${tgt}: ${threshold}超え ${hc}回/${total}回 (${(hc / total * 100).toFixed(1)}%)`);
    }
  }

  // 11. DF設定
  console.log(`\n■ ディープファネル`);
  const highByDf = groupBy(high, d => {
    const ci = meta.get(d.campaignId);
    return ci?.dfToggle === 'ON' ? `ON(${ci.dfEvent})` : 'OFF';
  });
  const lowByDf = groupBy(low, d => {
    const ci = meta.get(d.campaignId);
    return ci?.dfToggle === 'ON' ? `ON(${ci.dfEvent})` : 'OFF';
  });
  for (const df of [...new Set([...highByDf.keys(), ...lowByDf.keys()])]) {
    const hc = highByDf.get(df)?.length || 0;
    const lc = lowByDf.get(df)?.length || 0;
    const total = hc + lc;
    console.log(`  ${df}: ${threshold}超え ${hc}回/${total}回 (${(hc / total * 100).toFixed(1)}%)`);
  }

  // 12. 曜日
  console.log(`\n■ 曜日`);
  const dowNames = ['日', '月', '火', '水', '木', '金', '土'];
  const highByDow = groupBy(high, d => dowNames[new Date(d.date).getDay()]);
  const lowByDow = groupBy(low, d => dowNames[new Date(d.date).getDay()]);
  for (const dow of dowNames) {
    const hc = highByDow.get(dow)?.length || 0;
    const lc = lowByDow.get(dow)?.length || 0;
    const total = hc + lc;
    if (total > 0) {
      console.log(`  ${dow}: ${threshold}超え ${hc}回/${total}回 (${(hc / total * 100).toFixed(1)}%)`);
    }
  }

  // 13. キャンペーン経過日数
  console.log(`\n■ キャンペーン経過日数（作成日からの日数）`);
  const highAge = high.map(d => {
    const ci = meta.get(d.campaignId);
    return ci?.createdDate ? daysSince(ci.createdDate, d.date) : null;
  }).filter((a): a is number => a !== null && a >= 0);
  const lowAge = low.map(d => {
    const ci = meta.get(d.campaignId);
    return ci?.createdDate ? daysSince(ci.createdDate, d.date) : null;
  }).filter((a): a is number => a !== null && a >= 0);
  if (highAge.length > 0) {
    console.log(`  ${threshold}CV超え: 平均 ${avg(highAge).toFixed(1)}日 / 中央値 ${median(highAge)}日 / 範囲 ${Math.min(...highAge)}〜${Math.max(...highAge)}日`);
  }
  if (lowAge.length > 0) {
    console.log(`  ${threshold}CV未満: 平均 ${avg(lowAge).toFixed(1)}日 / 中央値 ${median(lowAge)}日 / 範囲 ${Math.min(...lowAge)}〜${Math.max(...lowAge)}日`);
  }

  // 14. 連続日数（同一キャンペーンで前後日も閾値超えか）
  console.log(`\n■ 連続性（同一キャンペーンの前後日）`);
  const campDayMap = new Map<string, Map<string, number>>();
  for (const d of [...high, ...low]) {
    if (!campDayMap.has(d.campaignId)) campDayMap.set(d.campaignId, new Map());
    campDayMap.get(d.campaignId)!.set(d.date, d.cv);
  }

  let streakCount = 0;
  let isolatedCount = 0;
  for (const d of high) {
    const days = campDayMap.get(d.campaignId)!;
    const prevDate = addDays(d.date, -1);
    const nextDate = addDays(d.date, 1);
    const prevCv = days.get(prevDate) || 0;
    const nextCv = days.get(nextDate) || 0;
    if (prevCv >= threshold || nextCv >= threshold) {
      streakCount++;
    } else {
      isolatedCount++;
    }
  }
  console.log(`  連続（前後日も${threshold}CV超え）: ${streakCount}回 (${(streakCount / high.length * 100).toFixed(1)}%)`);
  console.log(`  単発（前後日は${threshold}CV未満）: ${isolatedCount}回 (${(isolatedCount / high.length * 100).toFixed(1)}%)`);

  // 前日CVの分布
  console.log(`\n  前日CV分布（${threshold}CV超え日の前日）:`);
  const prevCvs = high.map(d => {
    const days = campDayMap.get(d.campaignId)!;
    return days.get(addDays(d.date, -1)) || 0;
  });
  console.log(`    平均: ${avg(prevCvs).toFixed(1)}CV / 中央値: ${median(prevCvs)}CV`);

  // 15. 同一キャンペーンの出現回数（再現性）
  console.log(`\n■ キャンペーン別 ${threshold}CV超え回数`);
  const campHighCount = new Map<string, number>();
  for (const d of high) {
    campHighCount.set(d.campaignId, (campHighCount.get(d.campaignId) || 0) + 1);
  }
  const sorted = [...campHighCount.entries()].sort((a, b) => b[1] - a[1]);
  for (const [campId, count] of sorted) {
    const ci = meta.get(campId);
    const totalDays = campDayMap.get(campId)?.size || 0;
    const tgt = ci?.targeting === 'MANUAL' ? '手動' : 'ノンタゲ';
    console.log(`  ${count}回/${totalDays}日 (${(count / totalDays * 100).toFixed(0)}%) | ${ci?.account} | CR${ci?.creativeCount}本 | ${tgt} | DF:${ci?.dfToggle} | ${ci?.name}`);
  }

  // ---- まとめ ----
  console.log(`\n${'='.repeat(60)}`);
  console.log('共通点サマリー');
  console.log(`${'='.repeat(60)}`);
  console.log(`\n分析対象: ${threshold}CV超え ${high.length}件 vs ${threshold}CV未満 ${low.length}件`);
  console.log(`\n以下の差が大きい変数が${threshold}CV超えの共通因子候補:`);

  // 差が大きい変数をハイライト
  const diffs: { name: string; highVal: string; lowVal: string; diff: string }[] = [];

  diffs.push({ name: 'CPA', highVal: `¥${Math.round(highCpa).toLocaleString()}`, lowVal: `¥${Math.round(lowCpa).toLocaleString()}`, diff: `${((highCpa / lowCpa - 1) * 100).toFixed(0)}%` });

  const hCpc = avg(high.map(d => d.cpc));
  const lCpc = avg(low.map(d => d.cpc));
  diffs.push({ name: 'CPC', highVal: `¥${Math.round(hCpc)}`, lowVal: `¥${Math.round(lCpc)}`, diff: `${((hCpc / lCpc - 1) * 100).toFixed(0)}%` });

  const hCtr = avg(high.map(d => d.ctr));
  const lCtr = avg(low.map(d => d.ctr));
  diffs.push({ name: 'CTR', highVal: `${(hCtr * 100).toFixed(2)}%`, lowVal: `${(lCtr * 100).toFixed(2)}%`, diff: `${((hCtr / lCtr - 1) * 100).toFixed(0)}%` });

  const hCvrAvg = avg(highCvr);
  const lCvrAvg = avg(lowCvr);
  diffs.push({ name: 'CVR', highVal: `${(hCvrAvg * 100).toFixed(2)}%`, lowVal: `${(lCvrAvg * 100).toFixed(2)}%`, diff: `${((hCvrAvg / lCvrAvg - 1) * 100).toFixed(0)}%` });

  if (highCr.length > 0 && lowCr.length > 0) {
    diffs.push({ name: 'CR数', highVal: `${avg(highCr).toFixed(1)}本`, lowVal: `${avg(lowCr).toFixed(1)}本`, diff: `${((avg(highCr) / avg(lowCr) - 1) * 100).toFixed(0)}%` });
  }

  if (highAge.length > 0 && lowAge.length > 0) {
    diffs.push({ name: '経過日数', highVal: `${avg(highAge).toFixed(1)}日`, lowVal: `${avg(lowAge).toFixed(1)}日`, diff: `${((avg(highAge) / avg(lowAge) - 1) * 100).toFixed(0)}%` });
  }

  for (const d of diffs) {
    console.log(`  ${d.name.padEnd(8)} | 超え: ${d.highVal.padEnd(10)} | 未満: ${d.lowVal.padEnd(10)} | 差: ${d.diff}`);
  }
}

// ユーティリティ
function avg(arr: number[]): number { return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function median(arr: number[]): number { if (arr.length === 0) return 0; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function groupBy<T>(arr: T[], fn: (t: T) => string): Map<string, T[]> { const m = new Map<string, T[]>(); for (const t of arr) { const k = fn(t); if (!m.has(k)) m.set(k, []); m.get(k)!.push(t); } return m; }
function daysSince(yymmdd: string, dateStr: string): number {
  const y = parseInt('20' + yymmdd.substring(0, 2));
  const m = parseInt(yymmdd.substring(2, 4)) - 1;
  const d = parseInt(yymmdd.substring(4, 6));
  const created = new Date(y, m, d);
  const target = new Date(dateStr);
  return Math.floor((target.getTime() - created.getTime()) / 86400000);
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

main().catch(console.error);
