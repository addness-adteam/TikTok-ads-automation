/**
 * 通常1-1-1広告で同じ動画が複数キャンペーンに使われているケースを探し、
 * キャンペーンID間の成績差を分析
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
  { id: '7247073333517238273', name: 'SNS1' },
  { id: '7543540100849156112', name: 'SNS2' },
  { id: '7543540381615800337', name: 'SNS3' },
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

async function main() {
  console.log(`=== 通常1-1-1広告: 同一動画×複数キャンペーンの成績差 (${startDate}〜${endDate}) ===\n`);

  // video_id → [{adId, adName, campaignId, accName}]
  const videoMap = new Map<string, { adId: string; adName: string; campaignId: string; accName: string; accId: string }[]>();

  // 全アカウントの通常広告を取得
  for (const acc of ACCOUNTS) {
    process.stdout.write(`${acc.name}...`);
    let page = 1;
    let count = 0;
    while (true) {
      const resp = await get('/v1.3/ad/get/', {
        advertiser_id: acc.id, page_size: '100', page: String(page),
        fields: JSON.stringify(['ad_id', 'ad_name', 'video_id', 'campaign_id']),
      });
      if (resp.code !== 0) break;
      const list = resp.data?.list || [];
      for (const ad of list) {
        if (!ad.video_id) continue;
        if (!videoMap.has(ad.video_id)) videoMap.set(ad.video_id, []);
        videoMap.get(ad.video_id)!.push({
          adId: ad.ad_id, adName: ad.ad_name, campaignId: ad.campaign_id,
          accName: acc.name, accId: acc.id,
        });
        count++;
      }
      if (list.length < 100) break;
      page++;
    }
    console.log(` ${count}件`);
  }

  // 同一アカウント内で同じ動画が2+キャンペーンに使われているケースを抽出
  const dupes: { videoId: string; entries: typeof videoMap extends Map<string, infer V> ? V : never }[] = [];
  for (const [videoId, entries] of videoMap) {
    // 同一アカウント内でキャンペーンIDが異なるもの
    const byAcc = new Map<string, typeof entries>();
    for (const e of entries) {
      if (!byAcc.has(e.accName)) byAcc.set(e.accName, []);
      byAcc.get(e.accName)!.push(e);
    }
    for (const [accName, accEntries] of byAcc) {
      const uniqueCamps = new Set(accEntries.map(e => e.campaignId));
      if (uniqueCamps.size >= 2) {
        dupes.push({ videoId, entries: accEntries });
      }
    }
  }

  console.log(`\n同一アカウント・同一動画で複数キャンペーン: ${dupes.length}件\n`);

  // 各ペアの成績を取得
  interface CampPerf { campId: string; adId: string; adName: string; accId: string; accName: string; totalCv: number; totalSpend: number; maxDayCv: number; days: number }

  const results: { videoId: string; campaigns: CampPerf[] }[] = [];

  // 上位30件に絞る（API負荷軽減）
  const topDupes = dupes.slice(0, 30);

  for (const dupe of topDupes) {
    const camps: CampPerf[] = [];
    const uniqueCamps = [...new Set(dupe.entries.map(e => e.campaignId))];

    for (const campId of uniqueCamps) {
      const entry = dupe.entries.find(e => e.campaignId === campId)!;
      // キャンペーン日別レポート
      const resp = await get('/v1.3/report/integrated/get/', {
        advertiser_id: entry.accId, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
        metrics: JSON.stringify(['spend', 'conversion']),
        start_date: startDate, end_date: endDate,
        filtering: JSON.stringify([{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify([campId]) }]),
        page_size: '100',
      });
      let totalCv = 0, totalSpend = 0, maxDayCv = 0, days = 0;
      for (const r of resp.data?.list || []) {
        const cv = parseInt(r.metrics?.conversion || '0');
        const spend = parseFloat(r.metrics?.spend || '0');
        if (spend > 0) days++;
        totalCv += cv;
        totalSpend += spend;
        if (cv > maxDayCv) maxDayCv = cv;
      }
      camps.push({ campId, adId: entry.adId, adName: entry.adName, accId: entry.accId, accName: entry.accName, totalCv, totalSpend, maxDayCv, days });
    }

    // CVが出ているペアのみ残す
    if (camps.some(c => c.totalCv >= 3)) {
      results.push({ videoId: dupe.videoId, campaigns: camps.sort((a, b) => b.totalCv - a.totalCv) });
    }
  }

  // CV差が大きい順にソート
  results.sort((a, b) => {
    const diffA = a.campaigns[0].totalCv - a.campaigns[a.campaigns.length - 1].totalCv;
    const diffB = b.campaigns[0].totalCv - b.campaigns[b.campaigns.length - 1].totalCv;
    return diffB - diffA;
  });

  console.log('='.repeat(80));
  console.log('同一動画・同一アカウント・異キャンペーンの成績比較（CV差大きい順）');
  console.log('='.repeat(80));

  for (const r of results) {
    const best = r.campaigns[0];
    const worst = r.campaigns[r.campaigns.length - 1];
    const ratio = worst.totalCv > 0 ? (best.totalCv / worst.totalCv).toFixed(1) : '∞';

    console.log(`\n--- 動画: ${r.videoId} (${best.accName}) ---`);
    for (const c of r.campaigns) {
      const cpa = c.totalCv > 0 ? `¥${Math.round(c.totalSpend / c.totalCv).toLocaleString()}` : '-';
      const bar = '█'.repeat(Math.min(c.totalCv, 40));
      console.log(`  ${c.adName}`);
      console.log(`    camp:${c.campId} | ${c.totalCv}CV | ¥${Math.round(c.totalSpend).toLocaleString()} | CPA ${cpa} | 最高${c.maxDayCv}CV/日 | ${c.days}日 | ${bar}`);
    }
    console.log(`  → 最大/最小 = ${ratio}倍差`);
  }

  // サマリー
  console.log('\n' + '='.repeat(80));
  console.log('サマリー');
  console.log('='.repeat(80));

  const ratios: number[] = [];
  for (const r of results) {
    const best = r.campaigns[0].totalCv;
    const worst = r.campaigns[r.campaigns.length - 1].totalCv;
    if (worst > 0) ratios.push(best / worst);
  }

  console.log(`\n分析対象: ${results.length}組（同一動画×同一アカウント×複数キャンペーン）`);
  if (ratios.length > 0) {
    console.log(`CV倍率（最良/最悪）:`);
    console.log(`  平均: ${(ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(1)}倍`);
    console.log(`  中央値: ${ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)].toFixed(1)}倍`);
    console.log(`  最大: ${Math.max(...ratios).toFixed(1)}倍`);
  }

  // 2倍以上差がついた組の数
  const bigDiff = ratios.filter(r => r >= 2).length;
  console.log(`  2倍以上差: ${bigDiff}/${ratios.length}組 (${(bigDiff / ratios.length * 100).toFixed(0)}%)`);
}

main().catch(console.error);
