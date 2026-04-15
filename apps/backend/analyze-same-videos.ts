/**
 * 同じ動画セットを使ったスマプラの成功/不成功を比較
 * - 「過去の当たりCR」17本: AI_1 vs AI_2
 * - 「CR454横展開」6本: AI_1 vs AI_2 vs AI_3 vs AI_4
 * - 同一アカウント内で新旧キャンペーンがあればその比較
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

async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

const now = new Date();
const endDate = jstDate(now);
const startDate = jstDate(new Date(now.getTime() - 30 * 86400000));

async function getCampaignDailyData(advId: string, campId: string): Promise<{ date: string; cv: number; spend: number; impressions: number; clicks: number; cpa: number }[]> {
  const resp = await get('/v1.3/report/integrated/get/', {
    advertiser_id: advId, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
    dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
    metrics: JSON.stringify(['spend', 'conversion', 'impressions', 'clicks', 'cost_per_conversion', 'cpc', 'ctr']),
    start_date: startDate, end_date: endDate,
    filtering: JSON.stringify([{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify([campId]) }]),
    page_size: '100',
  });
  return (resp.data?.list || []).map((r: any) => ({
    date: r.dimensions?.stat_time_day?.split(' ')[0] || '',
    cv: parseInt(r.metrics?.conversion || '0'),
    spend: parseFloat(r.metrics?.spend || '0'),
    impressions: parseInt(r.metrics?.impressions || '0'),
    clicks: parseInt(r.metrics?.clicks || '0'),
    cpa: parseFloat(r.metrics?.cost_per_conversion || '0'),
  })).sort((a: any, b: any) => a.date.localeCompare(b.date));
}

async function getAdDailyData(advId: string, campId: string): Promise<Map<string, { date: string; adId: string; cv: number; spend: number }[]>> {
  const resp = await get('/v1.3/report/integrated/get/', {
    advertiser_id: advId, report_type: 'BASIC', data_level: 'AUCTION_AD',
    dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
    metrics: JSON.stringify(['spend', 'conversion']),
    start_date: startDate, end_date: endDate,
    filtering: JSON.stringify([{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify([campId]) }]),
    page_size: '1000',
  });
  const byDate = new Map<string, { date: string; adId: string; cv: number; spend: number }[]>();
  for (const r of resp.data?.list || []) {
    const date = r.dimensions?.stat_time_day?.split(' ')[0] || '';
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push({
      date,
      adId: r.dimensions?.ad_id,
      cv: parseInt(r.metrics?.conversion || '0'),
      spend: parseFloat(r.metrics?.spend || '0'),
    });
  }
  return byDate;
}

async function getSmartPlusInfo(advId: string, campId: string) {
  const adResp = await get('/v1.3/smart_plus/ad/get/', {
    advertiser_id: advId,
    filtering: JSON.stringify({ campaign_ids: [campId] }),
    fields: JSON.stringify(['smart_plus_ad_id', 'ad_name', 'creative_list', 'operation_status']),
    page_size: '100',
  });
  const agResp = await get('/v1.3/smart_plus/adgroup/get/', {
    advertiser_id: advId, page_size: '100',
  });
  const ag = (agResp.data?.list || []).find((a: any) => a.campaign_id === campId);
  return { ads: adResp.data?.list || [], adgroup: ag };
}

async function main() {
  // ========================================
  // まず全アカウントで「過去の当たりCR」「CR454横展開」キャンペーンを探す
  // ========================================
  console.log('=== 同じ動画セットのスマプラ 成功/不成功比較 ===\n');
  console.log('全アカウントでキャンペーン検索中...');

  interface CampEntry {
    campId: string; name: string; accId: string; accName: string;
  }
  const ataricr: CampEntry[] = []; // 過去の当たりCR
  const cr454: CampEntry[] = [];   // CR454横展開

  for (const acc of ACCOUNTS) {
    let page = 1;
    while (true) {
      const resp = await get('/v1.3/campaign/get/', {
        advertiser_id: acc.id,
        fields: JSON.stringify(['campaign_id', 'campaign_name']),
        page_size: '100', page: String(page),
      });
      if (resp.code !== 0) break;
      for (const c of resp.data?.list || []) {
        const entry = { campId: c.campaign_id, name: c.campaign_name, accId: acc.id, accName: acc.name };
        if (c.campaign_name?.includes('過去の当たりCR')) ataricr.push(entry);
        if (c.campaign_name?.includes('CR454')) cr454.push(entry);
      }
      if ((resp.data?.list || []).length < 100) break;
      page++;
    }
  }

  console.log(`「過去の当たりCR」: ${ataricr.length}件`);
  for (const c of ataricr) console.log(`  ${c.accName}: ${c.name} (${c.campId})`);
  console.log(`「CR454横展開」: ${cr454.length}件`);
  for (const c of cr454) console.log(`  ${c.accName}: ${c.name} (${c.campId})`);

  // ========================================
  // 1. 「過去の当たりCR」比較
  // ========================================
  console.log('\n' + '='.repeat(70));
  console.log('1. 「過去の当たりCR」同じ17本 → アカウント間比較');
  console.log('='.repeat(70));

  for (const c of ataricr) {
    console.log(`\n--- ${c.accName}: ${c.name} ---`);
    const spInfo = await getSmartPlusInfo(c.accId, c.campId);
    const ag = spInfo.adgroup;
    const crCount = spInfo.ads.reduce((s: number, a: any) => s + (a.creative_list?.length || 0), 0);
    console.log(`CR数: ${crCount}, ターゲ: ${ag?.targeting_optimization_mode || '?'}, 年齢: ${(ag?.targeting_spec?.age_groups || []).map((g: string) => g.replace('AGE_', '').replace('_', '-')).join(',') || '?'}, DF: ${ag?.deep_funnel_toggle || '?'}, 日予算: ¥${ag?.budget || '?'}`);

    const daily = await getCampaignDailyData(c.accId, c.campId);
    const totalCv = daily.reduce((s, d) => s + d.cv, 0);
    const totalSpend = daily.reduce((s, d) => s + d.spend, 0);
    const maxDay = daily.reduce((max, d) => d.cv > max.cv ? d : max, { date: '', cv: 0, spend: 0, impressions: 0, clicks: 0, cpa: 0 });
    console.log(`期間: ${daily[0]?.date || '?'} 〜 ${daily[daily.length - 1]?.date || '?'} (${daily.length}日)`);
    console.log(`合計: ${totalCv}CV / ¥${Math.round(totalSpend).toLocaleString()} / CPA ¥${totalCv > 0 ? Math.round(totalSpend / totalCv).toLocaleString() : '-'}`);
    console.log(`最高日: ${maxDay.date} ${maxDay.cv}CV`);
    console.log('日別推移:');
    for (const d of daily) {
      const bar = '█'.repeat(Math.min(d.cv, 60));
      const marker = d.cv >= 30 ? ' ★' : '';
      console.log(`  ${d.date} | ${String(d.cv).padStart(3)}CV | ¥${Math.round(d.spend).toLocaleString().padStart(8)} | CPA ¥${d.cv > 0 ? Math.round(d.cpa).toLocaleString().padStart(6) : '     -'} | ${bar}${marker}`);
    }

    // 高CV日の広告別内訳
    if (maxDay.cv >= 20) {
      console.log(`\n  [${maxDay.date}の広告別内訳]`);
      const adDaily = await getAdDailyData(c.accId, c.campId);
      const dayAds = (adDaily.get(maxDay.date) || []).sort((a, b) => b.spend - a.spend);
      const dayTotalSpend = dayAds.reduce((s, a) => s + a.spend, 0);
      let cum = 0;
      for (const a of dayAds.slice(0, 5)) {
        cum += a.spend;
        console.log(`    ad:${a.adId} | ¥${Math.round(a.spend).toLocaleString().padStart(8)} (${(a.spend / dayTotalSpend * 100).toFixed(0)}%, 累積${(cum / dayTotalSpend * 100).toFixed(0)}%) | ${a.cv}CV`);
      }
      if (dayAds.length > 5) console.log(`    ...他${dayAds.length - 5}本`);
    }
  }

  // ========================================
  // 2. 「CR454横展開」比較
  // ========================================
  console.log('\n' + '='.repeat(70));
  console.log('2. 「CR454横展開」同じ6本 → アカウント間比較');
  console.log('='.repeat(70));

  for (const c of cr454) {
    console.log(`\n--- ${c.accName}: ${c.name} ---`);
    const spInfo = await getSmartPlusInfo(c.accId, c.campId);
    const ag = spInfo.adgroup;
    const crCount = spInfo.ads.reduce((s: number, a: any) => s + (a.creative_list?.length || 0), 0);
    console.log(`CR数: ${crCount}, ターゲ: ${ag?.targeting_optimization_mode || '?'}, 年齢: ${(ag?.targeting_spec?.age_groups || []).map((g: string) => g.replace('AGE_', '').replace('_', '-')).join(',') || '?'}, DF: ${ag?.deep_funnel_toggle || '?'}, 日予算: ¥${ag?.budget || '?'}`);

    const daily = await getCampaignDailyData(c.accId, c.campId);
    const totalCv = daily.reduce((s, d) => s + d.cv, 0);
    const totalSpend = daily.reduce((s, d) => s + d.spend, 0);
    const maxDay = daily.reduce((max, d) => d.cv > max.cv ? d : max, { date: '', cv: 0, spend: 0, impressions: 0, clicks: 0, cpa: 0 });
    console.log(`期間: ${daily[0]?.date || '?'} 〜 ${daily[daily.length - 1]?.date || '?'} (${daily.length}日)`);
    console.log(`合計: ${totalCv}CV / ¥${Math.round(totalSpend).toLocaleString()} / CPA ¥${totalCv > 0 ? Math.round(totalSpend / totalCv).toLocaleString() : '-'}`);
    console.log(`最高日: ${maxDay.date} ${maxDay.cv}CV`);
    console.log('日別推移:');
    for (const d of daily) {
      const bar = '█'.repeat(Math.min(d.cv, 60));
      console.log(`  ${d.date} | ${String(d.cv).padStart(3)}CV | ¥${Math.round(d.spend).toLocaleString().padStart(8)} | CPA ¥${d.cv > 0 ? Math.round(d.cpa).toLocaleString().padStart(6) : '     -'} | ${bar}`);
    }
  }

  // ========================================
  // 3. 比較サマリー
  // ========================================
  console.log('\n' + '='.repeat(70));
  console.log('3. 比較サマリー');
  console.log('='.repeat(70));

  console.log('\n「過去の当たりCR」17本:');
  for (const c of ataricr) {
    const daily = await getCampaignDailyData(c.accId, c.campId);
    const totalCv = daily.reduce((s, d) => s + d.cv, 0);
    const totalSpend = daily.reduce((s, d) => s + d.spend, 0);
    const maxCv = Math.max(...daily.map(d => d.cv), 0);
    const avgCv = daily.length > 0 ? (totalCv / daily.length).toFixed(1) : '0';
    const spInfo = await getSmartPlusInfo(c.accId, c.campId);
    const ag = spInfo.adgroup;
    const tgt = ag?.targeting_optimization_mode === 'MANUAL' ? `手動(${(ag?.targeting_spec?.age_groups || []).map((g: string) => g.replace('AGE_', '').replace('_', '-')).join(',')})` : 'ノンタゲ';
    console.log(`  ${c.accName.padEnd(5)} | 最高${String(maxCv).padStart(3)}CV | 平均${avgCv.padStart(5)}CV/日 | 合計${String(totalCv).padStart(4)}CV | CPA ¥${totalCv > 0 ? Math.round(totalSpend / totalCv).toLocaleString().padStart(6) : '     -'} | ${tgt} | ${daily.length}日`);
  }

  console.log('\n「CR454横展開」6本:');
  for (const c of cr454) {
    const daily = await getCampaignDailyData(c.accId, c.campId);
    const totalCv = daily.reduce((s, d) => s + d.cv, 0);
    const totalSpend = daily.reduce((s, d) => s + d.spend, 0);
    const maxCv = Math.max(...daily.map(d => d.cv), 0);
    const avgCv = daily.length > 0 ? (totalCv / daily.length).toFixed(1) : '0';
    const spInfo = await getSmartPlusInfo(c.accId, c.campId);
    const ag = spInfo.adgroup;
    const tgt = ag?.targeting_optimization_mode === 'MANUAL' ? `手動(${(ag?.targeting_spec?.age_groups || []).map((g: string) => g.replace('AGE_', '').replace('_', '-')).join(',')})` : 'ノンタゲ';
    console.log(`  ${c.accName.padEnd(5)} | 最高${String(maxCv).padStart(3)}CV | 平均${avgCv.padStart(5)}CV/日 | 合計${String(totalCv).padStart(4)}CV | CPA ¥${totalCv > 0 ? Math.round(totalSpend / totalCv).toLocaleString().padStart(6) : '     -'} | ${tgt} | ${daily.length}日`);
  }
}

main().catch(console.error);
