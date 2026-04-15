/**
 * キャンペーンのライフサイクル分析
 * 経過日数ごとのCV推移を見て、何日目にピーク→何日目に枯れるかを特定
 * → 複製タイミングの根拠にする
 *
 * npx tsx apps/backend/analyze-campaign-lifecycle.ts
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
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
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
  cv: number; spend: number; cpa: number; cpc: number; impressions: number;
}

interface CampInfo {
  name: string; account: string; creativeCount: number; isSmart: boolean;
  targeting: string; createdDate: string; // YYYY-MM-DD（広告名のYYMMDDから）
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

  console.log(`=== キャンペーンライフサイクル分析（AI導線スマプラ）===`);
  console.log(`期間: ${startDate} 〜 ${endDate}\n`);

  // STEP 1: 日別データ取得
  console.log('STEP 1: 日別データ取得...');
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
          metrics: JSON.stringify(['spend', 'conversion', 'impressions', 'clicks', 'cpc', 'cost_per_conversion']),
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
            impressions: parseInt(row.metrics?.impressions || '0'),
          });
          count++;
        }
        if (list.length < 1000) break;
        page++;
      }
    }
    console.log(` ${count}行`);
  }

  // STEP 2: キャンペーン情報取得
  console.log('\nSTEP 2: キャンペーン詳細取得...');
  const campInfo = new Map<string, CampInfo>();

  for (const acc of ACCOUNTS) {
    const ids = [...allCampaignIds].filter(id =>
      allDays.some(d => d.campaignId === id && d.accountName === acc.name));
    if (ids.length === 0) continue;
    process.stdout.write(`  ${acc.name}...`);

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
          const yy = dateMatch[1].substring(0, 2);
          const mm = dateMatch[1].substring(2, 4);
          const dd = dateMatch[1].substring(4, 6);
          createdDate = `20${yy}-${mm}-${dd}`;
        }
        campInfo.set(c.campaign_id, {
          name: c.campaign_name, account: acc.name,
          creativeCount: 0, isSmart: false,
          targeting: '不明', createdDate,
        });
      }
    }

    // Smart+広告グループ
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
        const ci = campInfo.get(ad.campaign_id);
        if (ci) { ci.creativeCount += (ad.creative_list?.length || 0); ci.isSmart = true; }
      }
      if ((adR.data?.list || []).length < 100) break;
      adPage++;
    }
    console.log(' OK');
  }

  // Smart+のみフィルタ + 作成日が分かるもの
  const smartDays = allDays.filter(d => {
    const ci = campInfo.get(d.campaignId);
    return ci?.isSmart && ci.createdDate;
  });

  console.log(`\nSmart+キャンペーン日別レコード（作成日あり）: ${smartDays.length}件`);

  // 経過日数を付与
  interface DayWithAge extends DayRecord { age: number; }
  const withAge: DayWithAge[] = smartDays.map(d => {
    const ci = campInfo.get(d.campaignId)!;
    return { ...d, age: daysBetween(ci.createdDate, d.date) };
  }).filter(d => d.age >= 0 && d.age <= 20); // 20日以内

  // ========================================
  // 分析1: 経過日数ごとのCV・CPA・費用の推移
  // ========================================
  console.log('\n========================================');
  console.log('分析1: 経過日数ごとの平均値推移');
  console.log('========================================\n');

  console.log('経過日 | 件数 | 平均CV | 中央CV | 平均CPA    | 平均費用       | 平均imp');
  for (let age = 0; age <= 15; age++) {
    const dayData = withAge.filter(d => d.age === age);
    if (dayData.length === 0) continue;
    const avgCv = dayData.reduce((s, d) => s + d.cv, 0) / dayData.length;
    const medCv = median(dayData.map(d => d.cv));
    const avgCpa = dayData.filter(d => d.cv > 0).reduce((s, d) => s + d.cpa, 0) / (dayData.filter(d => d.cv > 0).length || 1);
    const avgSpend = dayData.reduce((s, d) => s + d.spend, 0) / dayData.length;
    const avgImp = dayData.reduce((s, d) => s + d.impressions, 0) / dayData.length;
    console.log(`  ${String(age).padStart(2)}日目 | ${String(dayData.length).padStart(3)}件 | ${avgCv.toFixed(1).padStart(5)} | ${String(medCv).padStart(4)} | ¥${Math.round(avgCpa).toLocaleString().padStart(6)} | ¥${Math.round(avgSpend).toLocaleString().padStart(9)} | ${Math.round(avgImp).toLocaleString().padStart(9)}`);
  }

  // ========================================
  // 分析2: キャンペーンごとのピーク日と減衰パターン
  // ========================================
  console.log('\n========================================');
  console.log('分析2: キャンペーンごとのピーク日と減衰');
  console.log('========================================\n');

  // キャンペーン単位でグルーピング
  const campGroups = new Map<string, DayWithAge[]>();
  for (const d of withAge) {
    if (!campGroups.has(d.campaignId)) campGroups.set(d.campaignId, []);
    campGroups.get(d.campaignId)!.push(d);
  }

  // 3日以上データがあるキャンペーンのみ
  const multiDayCamps = [...campGroups.entries()]
    .filter(([, days]) => days.length >= 3)
    .sort((a, b) => {
      const maxA = Math.max(...a[1].map(d => d.cv));
      const maxB = Math.max(...b[1].map(d => d.cv));
      return maxB - maxA;
    });

  console.log(`3日以上データのあるキャンペーン: ${multiDayCamps.length}件\n`);

  for (const [campId, days] of multiDayCamps.slice(0, 15)) {
    const ci = campInfo.get(campId)!;
    const sorted = days.sort((a, b) => a.age - b.age);
    const peakDay = sorted.reduce((p, d) => d.cv > p.cv ? d : p, sorted[0]);
    const totalCv = sorted.reduce((s, d) => s + d.cv, 0);

    console.log(`--- ${ci.account} | CR${ci.creativeCount}本 | ${ci.targeting} | 合計${totalCv}CV | ${ci.name}`);

    // 日ごとの推移
    let prevCv = 0;
    for (const d of sorted) {
      const change = prevCv > 0 ? `${d.cv >= prevCv ? '+' : ''}${Math.round((d.cv / prevCv - 1) * 100)}%` : '';
      const marker = d === peakDay ? ' ★ピーク' : '';
      const bar = '█'.repeat(Math.min(Math.round(d.cv / 2), 50));
      console.log(`  ${String(d.age).padStart(2)}日目 | ${String(d.cv).padStart(3)}CV | CPA ¥${d.cv > 0 ? Math.round(d.cpa).toLocaleString().padStart(5) : '    -'} | ¥${Math.round(d.spend).toLocaleString().padStart(8)} | ${bar}${marker} ${change}`);
      prevCv = d.cv > 0 ? d.cv : prevCv;
    }

    // ピーク後の減衰率
    const afterPeak = sorted.filter(d => d.age > peakDay.age);
    if (afterPeak.length > 0) {
      const avgAfter = afterPeak.reduce((s, d) => s + d.cv, 0) / afterPeak.length;
      const decayRate = peakDay.cv > 0 ? ((1 - avgAfter / peakDay.cv) * 100).toFixed(0) : '?';
      console.log(`  → ピーク後平均: ${avgAfter.toFixed(1)}CV (ピークから-${decayRate}%)`);
    }
    console.log('');
  }

  // ========================================
  // 分析3: ピーク日の分布
  // ========================================
  console.log('========================================');
  console.log('分析3: ピーク日（最大CV日）の分布');
  console.log('========================================\n');

  const peakAges: number[] = [];
  for (const [, days] of multiDayCamps) {
    const peak = days.reduce((p, d) => d.cv > p.cv ? d : p, days[0]);
    peakAges.push(peak.age);
  }

  const peakDist = new Map<number, number>();
  for (const age of peakAges) peakDist.set(age, (peakDist.get(age) || 0) + 1);

  console.log('経過日 | ピーク回数 | 割合');
  for (let age = 0; age <= 10; age++) {
    const count = peakDist.get(age) || 0;
    if (count > 0) {
      const pct = (count / peakAges.length * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(count / peakAges.length * 30));
      console.log(`  ${String(age).padStart(2)}日目 | ${String(count).padStart(3)}件 | ${pct.padStart(5)}% ${bar}`);
    }
  }
  const over10 = peakAges.filter(a => a > 10).length;
  if (over10 > 0) console.log(`  11日〜 | ${over10}件 | ${(over10 / peakAges.length * 100).toFixed(1)}%`);

  // ========================================
  // 分析4: ピーク後の「枯れ」パターン
  // ========================================
  console.log('\n========================================');
  console.log('分析4: ピーク後の減衰パターン');
  console.log('========================================\n');

  // ピーク翌日のCV維持率
  const retentionRates: { day1: number; day2: number; day3: number }[] = [];
  for (const [, days] of multiDayCamps) {
    const sorted = days.sort((a, b) => a.age - b.age);
    const peak = sorted.reduce((p, d) => d.cv > p.cv ? d : p, sorted[0]);
    if (peak.cv < 5) continue; // ピーク5CV未満はノイズ

    const day1 = sorted.find(d => d.age === peak.age + 1);
    const day2 = sorted.find(d => d.age === peak.age + 2);
    const day3 = sorted.find(d => d.age === peak.age + 3);

    retentionRates.push({
      day1: day1 ? day1.cv / peak.cv : -1,
      day2: day2 ? day2.cv / peak.cv : -1,
      day3: day3 ? day3.cv / peak.cv : -1,
    });
  }

  const valid1 = retentionRates.filter(r => r.day1 >= 0).map(r => r.day1);
  const valid2 = retentionRates.filter(r => r.day2 >= 0).map(r => r.day2);
  const valid3 = retentionRates.filter(r => r.day3 >= 0).map(r => r.day3);

  console.log('ピーク後の維持率（ピーク日のCV数を100%として）:');
  if (valid1.length > 0) console.log(`  ピーク+1日: 平均 ${(avg(valid1) * 100).toFixed(0)}% / 中央値 ${(median(valid1) * 100).toFixed(0)}% (${valid1.length}件)`);
  if (valid2.length > 0) console.log(`  ピーク+2日: 平均 ${(avg(valid2) * 100).toFixed(0)}% / 中央値 ${(median(valid2) * 100).toFixed(0)}% (${valid2.length}件)`);
  if (valid3.length > 0) console.log(`  ピーク+3日: 平均 ${(avg(valid3) * 100).toFixed(0)}% / 中央値 ${(median(valid3) * 100).toFixed(0)}% (${valid3.length}件)`);

  // ========================================
  // 分析5: 複製シミュレーション
  // ========================================
  console.log('\n========================================');
  console.log('分析5: 複製タイミングシミュレーション');
  console.log('========================================\n');

  // もし N日ごとに複製して初速を再取得したら、平均CVはどうなるか
  for (const interval of [2, 3, 4, 5, 7]) {
    // 各キャンペーンの0日目〜(interval-1)日目のCVを取り、それが繰り返されると仮定
    const windowCvs: number[] = [];
    for (const [, days] of multiDayCamps) {
      const sorted = days.sort((a, b) => a.age - b.age);
      const window = sorted.filter(d => d.age < interval);
      if (window.length > 0) {
        const avgDailyCv = window.reduce((s, d) => s + d.cv, 0) / interval; // interval日で割る（データない日は0扱い）
        windowCvs.push(avgDailyCv);
      }
    }
    if (windowCvs.length > 0) {
      const overallAvg = avg(windowCvs);
      const over30pct = (windowCvs.filter(v => v >= 30).length / windowCvs.length * 100).toFixed(1);
      console.log(`  ${interval}日ごと複製: 平均日次CV ${overallAvg.toFixed(1)} | 30CV超え率 ${over30pct}% (${windowCvs.length}キャンペーン)`);
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
