/**
 * スパイク予兆分析
 * 20CV超え日を出したキャンペーンの「初日〜2日目」の指標を
 * スパイクしなかったキャンペーンと比較して、爆発の前兆を特定する
 *
 * npx tsx apps/backend/analyze-spike-predictors.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

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
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

interface DayRecord {
  date: string; campaignId: string; accountName: string;
  cv: number; spend: number; cpa: number; cpc: number; ctr: number;
  impressions: number; clicks: number;
  videoViews2s: number; videoViews6s: number;
}

interface CampInfo {
  name: string; account: string; creativeCount: number; isSmart: boolean;
  targeting: string; createdDate: string;
}

async function main() {
  const now = new Date();
  const endDate = jstDate(now);
  const midDate = jstDate(new Date(now.getTime() - 29 * 86400000));
  const startDate = jstDate(new Date(now.getTime() - 59 * 86400000));
  const periods = [
    { start: startDate, end: midDate },
    { start: addDays(midDate, 1), end: endDate },
  ];

  console.log(`=== スパイク予兆分析 ===`);
  console.log(`期間: ${startDate} 〜 ${endDate}\n`);

  // データ取得
  console.log('データ取得中...');
  const allDays: DayRecord[] = [];
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
        if (resp.code !== 0) break;
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
            spend, cpa: parseFloat(row.metrics?.cost_per_conversion || '0'),
            cpc: parseFloat(row.metrics?.cpc || '0'),
            ctr: parseFloat(row.metrics?.ctr || '0'),
            impressions: parseInt(row.metrics?.impressions || '0'),
            clicks: parseInt(row.metrics?.clicks || '0'),
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

  // キャンペーン情報取得
  console.log('キャンペーン詳細取得中...');
  const campInfo = new Map<string, CampInfo>();
  for (const acc of ACCOUNTS) {
    const ids = [...allCampaignIds].filter(id =>
      allDays.some(d => d.campaignId === id && d.accountName === acc.name));
    if (ids.length === 0) continue;

    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const cr = await get('/v1.3/campaign/get/', {
        advertiser_id: acc.id,
        filtering: JSON.stringify({ campaign_ids: batch }),
        fields: JSON.stringify(['campaign_id', 'campaign_name']),
        page_size: '100',
      });
      for (const c of cr.data?.list || []) {
        const dateMatch = c.campaign_name?.match(/(\d{6})/);
        let createdDate = '';
        if (dateMatch) {
          createdDate = `20${dateMatch[1].substring(0, 2)}-${dateMatch[1].substring(2, 4)}-${dateMatch[1].substring(4, 6)}`;
        }
        campInfo.set(c.campaign_id, {
          name: c.campaign_name, account: acc.name,
          creativeCount: 0, isSmart: false, targeting: '不明', createdDate,
        });
      }
    }

    let agPage = 1;
    while (true) {
      const agR = await get('/v1.3/smart_plus/adgroup/get/', { advertiser_id: acc.id, page_size: '100', page: String(agPage) });
      if (agR.code !== 0) break;
      for (const ag of agR.data?.list || []) {
        const ci = campInfo.get(ag.campaign_id);
        if (ci) ci.targeting = ag.targeting_optimization_mode || 'AUTOMATIC';
      }
      if ((agR.data?.list || []).length < 100) break;
      agPage++;
    }

    let adPage = 1;
    while (true) {
      const adR = await get('/v1.3/smart_plus/ad/get/', {
        advertiser_id: acc.id,
        fields: JSON.stringify(['smart_plus_ad_id', 'campaign_id', 'creative_list']),
        page_size: '100', page: String(adPage),
      });
      if (adR.code !== 0) break;
      for (const ad of adR.data?.list || []) {
        const ci = campInfo.get(ad.campaign_id);
        if (ci) { ci.creativeCount += (ad.creative_list?.length || 0); ci.isSmart = true; }
      }
      if ((adR.data?.list || []).length < 100) break;
      adPage++;
    }
  }

  // Smart+のみ、作成日ありでフィルタ
  const smartDays = allDays.filter(d => {
    const ci = campInfo.get(d.campaignId);
    return ci?.isSmart && ci.createdDate;
  });

  // キャンペーンごとに日別データをまとめる
  const campDays = new Map<string, DayRecord[]>();
  for (const d of smartDays) {
    if (!campDays.has(d.campaignId)) campDays.set(d.campaignId, []);
    campDays.get(d.campaignId)!.push(d);
  }

  // スパイク有無で分類（1日でも20CV超えがあるか）
  const SPIKE_THRESHOLD = 20;
  const spikedCamps: string[] = [];
  const nonSpikedCamps: string[] = [];

  for (const [campId, days] of campDays) {
    const maxCv = Math.max(...days.map(d => d.cv));
    if (maxCv >= SPIKE_THRESHOLD) {
      spikedCamps.push(campId);
    } else if (days.length >= 2) { // 2日以上データがあるもののみ
      nonSpikedCamps.push(campId);
    }
  }

  console.log(`\nスパイク(${SPIKE_THRESHOLD}CV超え日あり): ${spikedCamps.length}キャンペーン`);
  console.log(`非スパイク: ${nonSpikedCamps.length}キャンペーン\n`);

  // ========================================
  // 分析1: 初日（0日目）の指標比較
  // ========================================
  console.log('========================================');
  console.log('分析1: 初日（0日目）の指標比較');
  console.log('========================================\n');

  interface EarlyMetrics {
    cv: number; spend: number; cpa: number; cpc: number; ctr: number;
    impressions: number; clicks: number; cvr: number; view6sRate: number;
  }

  function getEarlyMetrics(campId: string, age: number): EarlyMetrics | null {
    const ci = campInfo.get(campId);
    if (!ci?.createdDate) return null;
    const days = campDays.get(campId) || [];
    const targetDate = addDays(ci.createdDate, age);
    const dayData = days.find(d => d.date === targetDate);
    if (!dayData) return null;
    return {
      cv: dayData.cv, spend: dayData.spend,
      cpa: dayData.cv > 0 ? dayData.cpa : 0,
      cpc: dayData.cpc, ctr: dayData.ctr,
      impressions: dayData.impressions, clicks: dayData.clicks,
      cvr: dayData.clicks > 0 ? dayData.cv / dayData.clicks : 0,
      view6sRate: dayData.impressions > 0 ? dayData.videoViews6s / dayData.impressions : 0,
    };
  }

  function compareGroup(label: string, age: number) {
    const spikedMetrics = spikedCamps.map(id => getEarlyMetrics(id, age)).filter((m): m is EarlyMetrics => m !== null);
    const nonSpikedMetrics = nonSpikedCamps.map(id => getEarlyMetrics(id, age)).filter((m): m is EarlyMetrics => m !== null);

    if (spikedMetrics.length === 0 || nonSpikedMetrics.length === 0) {
      console.log(`  ${label}: データ不足`);
      return;
    }

    console.log(`\n■ ${label} （スパイク${spikedMetrics.length}件 vs 非スパイク${nonSpikedMetrics.length}件）`);

    const metrics: { name: string; key: keyof EarlyMetrics; format: (v: number) => string }[] = [
      { name: 'CV数', key: 'cv', format: v => v.toFixed(1) },
      { name: '費用', key: 'spend', format: v => `¥${Math.round(v).toLocaleString()}` },
      { name: 'CPA', key: 'cpa', format: v => `¥${Math.round(v).toLocaleString()}` },
      { name: 'CPC', key: 'cpc', format: v => `¥${Math.round(v)}` },
      { name: 'CTR', key: 'ctr', format: v => `${(v * 100).toFixed(2)}%` },
      { name: 'imp', key: 'impressions', format: v => Math.round(v).toLocaleString() },
      { name: 'クリック', key: 'clicks', format: v => Math.round(v).toLocaleString() },
      { name: 'CVR', key: 'cvr', format: v => `${(v * 100).toFixed(2)}%` },
      { name: '6s視聴率', key: 'view6sRate', format: v => `${(v * 100).toFixed(2)}%` },
    ];

    for (const m of metrics) {
      const sVals = spikedMetrics.map(e => e[m.key]).filter(v => v > 0);
      const nVals = nonSpikedMetrics.map(e => e[m.key]).filter(v => v > 0);
      if (sVals.length === 0 || nVals.length === 0) continue;
      const sAvg = avg(sVals);
      const nAvg = avg(nVals);
      const diff = nAvg > 0 ? ((sAvg / nAvg - 1) * 100).toFixed(0) : '∞';
      console.log(`  ${m.name.padEnd(8)} | スパイク: ${m.format(sAvg).padEnd(12)} | 非: ${m.format(nAvg).padEnd(12)} | 差: ${diff}%`);
    }

    // 初日CV数の分布
    console.log(`\n  初日CV分布:`);
    const cvBuckets = [[0, 0], [1, 2], [3, 5], [6, 10], [11, 99]];
    for (const [lo, hi] of cvBuckets) {
      const sc = spikedMetrics.filter(m => m.cv >= lo && m.cv <= hi).length;
      const nc = nonSpikedMetrics.filter(m => m.cv >= lo && m.cv <= hi).length;
      const sRate = spikedMetrics.length > 0 ? (sc / spikedMetrics.length * 100).toFixed(0) : '0';
      const nRate = nonSpikedMetrics.length > 0 ? (nc / nonSpikedMetrics.length * 100).toFixed(0) : '0';
      console.log(`    CV ${lo}-${hi}: スパイク ${sRate}% (${sc}件) | 非 ${nRate}% (${nc}件)`);
    }
  }

  compareGroup('0日目（初日）', 0);
  compareGroup('1日目', 1);
  compareGroup('0-1日目合算', -1); // 特殊処理

  // 0-1日目合算を手動で
  console.log('\n■ 0+1日目の合算CV');
  const spiked2day = spikedCamps.map(id => {
    const d0 = getEarlyMetrics(id, 0);
    const d1 = getEarlyMetrics(id, 1);
    return { cv: (d0?.cv || 0) + (d1?.cv || 0), spend: (d0?.spend || 0) + (d1?.spend || 0), name: campInfo.get(id)?.name || '' };
  }).filter(d => d.spend > 0);

  const nonSpiked2day = nonSpikedCamps.map(id => {
    const d0 = getEarlyMetrics(id, 0);
    const d1 = getEarlyMetrics(id, 1);
    return { cv: (d0?.cv || 0) + (d1?.cv || 0), spend: (d0?.spend || 0) + (d1?.spend || 0) };
  }).filter(d => d.spend > 0);

  if (spiked2day.length > 0 && nonSpiked2day.length > 0) {
    console.log(`  スパイク群: 平均 ${avg(spiked2day.map(d => d.cv)).toFixed(1)}CV / 中央値 ${median(spiked2day.map(d => d.cv))}CV`);
    console.log(`  非スパイク群: 平均 ${avg(nonSpiked2day.map(d => d.cv)).toFixed(1)}CV / 中央値 ${median(nonSpiked2day.map(d => d.cv))}CV`);

    // 閾値ごとのスパイク率
    console.log('\n  2日間合計CVごとのスパイク確率:');
    const thresholds = [1, 3, 5, 8, 10, 15, 20];
    for (const t of thresholds) {
      const sOver = spiked2day.filter(d => d.cv >= t).length;
      const nOver = nonSpiked2day.filter(d => d.cv >= t).length;
      const total = sOver + nOver;
      if (total > 0) {
        console.log(`    ≥${String(t).padStart(2)}CV: スパイク ${sOver}/${total} (${(sOver / total * 100).toFixed(0)}%) | 非 ${nOver}/${total} (${(nOver / total * 100).toFixed(0)}%)`);
      }
    }
  }

  // ========================================
  // 分析2: スパイクしたキャンペーンの詳細
  // ========================================
  console.log('\n\n========================================');
  console.log('分析2: スパイクキャンペーンの詳細（スパイク前の指標付き）');
  console.log('========================================\n');

  const spikeDetails = spikedCamps.map(id => {
    const days = campDays.get(id) || [];
    const ci = campInfo.get(id)!;
    const maxDay = days.reduce((p, d) => d.cv > p.cv ? d : p, days[0]);
    const age = daysBetween(ci.createdDate, maxDay.date);
    const d0 = getEarlyMetrics(id, 0);
    const d1 = getEarlyMetrics(id, 1);
    return { campId: id, ci, maxCv: maxDay.cv, maxDate: maxDay.date, peakAge: age,
      day0Cv: d0?.cv || 0, day0Cpa: d0?.cpa || 0, day0Cpc: d0?.cpc || 0, day0Imp: d0?.impressions || 0,
      day1Cv: d1?.cv || 0, day1Cpa: d1?.cpa || 0, day1Cpc: d1?.cpc || 0, day1Imp: d1?.impressions || 0,
      totalCv: days.reduce((s, d) => s + d.cv, 0), totalDays: days.length,
    };
  }).sort((a, b) => b.maxCv - a.maxCv);

  console.log('最大CV | ピーク日齢 | 0日目CV | 0日目CPA | 1日目CV | 1日目CPA | CR数 | ターゲ | アカウント | キャンペーン名');
  for (const s of spikeDetails) {
    console.log(`  ${String(s.maxCv).padStart(3)}CV | ${String(s.peakAge).padStart(2)}日目 | ${String(s.day0Cv).padStart(3)}CV | ¥${s.day0Cpa > 0 ? Math.round(s.day0Cpa).toLocaleString().padStart(5) : '    -'} | ${String(s.day1Cv).padStart(3)}CV | ¥${s.day1Cpa > 0 ? Math.round(s.day1Cpa).toLocaleString().padStart(5) : '    -'} | ${String(s.ci.creativeCount).padStart(2)}本 | ${s.ci.targeting === 'MANUAL' ? '手動' : 'ノンタ'} | ${s.ci.account} | ${s.ci.name}`);
  }

  // ========================================
  // 分析3: 同じ動画/CRが別キャンペーンでもスパイクしたか
  // ========================================
  console.log('\n\n========================================');
  console.log('分析3: 同じCR名が別キャンペーンでスパイクした再現性');
  console.log('========================================\n');

  // CR名を広告名から抽出（/の3番目のセグメント）
  const crNameMap = new Map<string, { campId: string; maxCv: number; account: string; name: string }[]>();
  for (const s of spikeDetails) {
    const parts = s.ci.name.split('/');
    const crName = parts.length >= 3 ? parts[2] : s.ci.name;
    if (!crNameMap.has(crName)) crNameMap.set(crName, []);
    crNameMap.get(crName)!.push({ campId: s.campId, maxCv: s.maxCv, account: s.ci.account, name: s.ci.name });
  }

  // 複数キャンペーンでスパイクしたCR
  console.log('同一CR名で複数回スパイク:');
  let found = false;
  for (const [crName, entries] of crNameMap) {
    if (entries.length >= 2) {
      found = true;
      console.log(`\n  「${crName}」: ${entries.length}キャンペーンでスパイク`);
      for (const e of entries) {
        console.log(`    ${e.maxCv}CV | ${e.account} | ${e.name}`);
      }
    }
  }
  if (!found) console.log('  複数回スパイクしたCRなし');

  // 全キャンペーンで同一CR名のものを探す（スパイク有無関係なく）
  console.log('\n\nスパイクCRの他キャンペーンでの成績:');
  const spikedCrNames = new Set<string>();
  for (const s of spikeDetails) {
    const parts = s.ci.name.split('/');
    if (parts.length >= 3) spikedCrNames.add(parts[2]);
  }

  for (const crName of spikedCrNames) {
    const allWithCr: { campId: string; maxCv: number; account: string; name: string; spiked: boolean }[] = [];
    for (const [campId, days] of campDays) {
      const ci = campInfo.get(campId);
      if (!ci) continue;
      const parts = ci.name.split('/');
      const thisCr = parts.length >= 3 ? parts[2] : ci.name;
      if (thisCr === crName) {
        const maxCv = Math.max(...days.map(d => d.cv));
        allWithCr.push({ campId, maxCv, account: ci.account, name: ci.name, spiked: maxCv >= SPIKE_THRESHOLD });
      }
    }
    if (allWithCr.length >= 2) {
      const spikedCount = allWithCr.filter(c => c.spiked).length;
      console.log(`\n  「${crName}」: ${allWithCr.length}キャンペーン中 ${spikedCount}件スパイク (${(spikedCount / allWithCr.length * 100).toFixed(0)}%)`);
      for (const c of allWithCr.sort((a, b) => b.maxCv - a.maxCv)) {
        console.log(`    ${c.spiked ? '★' : ' '} ${String(c.maxCv).padStart(3)}CV | ${c.account} | ${c.name}`);
      }
    }
  }

  // ========================================
  // 分析4: スパイク直前日の特徴（スパイク日の前日）
  // ========================================
  console.log('\n\n========================================');
  console.log('分析4: スパイク直前日の特徴');
  console.log('========================================\n');

  console.log('スパイク日の前日の指標（スパイク＝その日20CV超え）:');
  for (const s of spikeDetails) {
    const days = (campDays.get(s.campId) || []).sort((a, b) => a.date.localeCompare(b.date));
    // 20CV超えの各日について前日を見る
    for (const day of days) {
      if (day.cv < SPIKE_THRESHOLD) continue;
      const prevDate = addDays(day.date, -1);
      const prevDay = days.find(d => d.date === prevDate);
      const ci = campInfo.get(s.campId)!;
      const age = daysBetween(ci.createdDate, day.date);
      if (prevDay) {
        console.log(`  ${day.date} ${day.cv}CV | 前日: ${prevDay.cv}CV, CPA ¥${prevDay.cv > 0 ? Math.round(prevDay.cpa).toLocaleString() : '-'}, ¥${Math.round(prevDay.spend).toLocaleString()}, imp ${prevDay.impressions.toLocaleString()} | ${age}日目 | ${ci.name}`);
      } else {
        console.log(`  ${day.date} ${day.cv}CV | 前日: データなし | ${age}日目 | ${ci.name}`);
      }
    }
  }

  console.log('\n=== 分析完了 ===');
}

function avg(arr: number[]): number { return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

main().catch(console.error);
