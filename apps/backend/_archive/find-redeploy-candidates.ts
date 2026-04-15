/**
 * 再出稿候補の特定（AI_1, AI_2）
 * スパイク実績のあるCRの現在のステータスと再出稿可否を確認
 *
 * npx tsx apps/backend/find-redeploy-candidates.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

const TARGETS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
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

async function main() {
  const now = new Date();
  const endDate = jstDate(now);
  const midDate = jstDate(new Date(now.getTime() - 29 * 86400000));
  const startDate = jstDate(new Date(now.getTime() - 59 * 86400000));
  const periods = [
    { start: startDate, end: midDate },
    { start: addDays(midDate, 1), end: endDate },
  ];

  console.log(`=== 再出稿候補リスト（AI_1 / AI_2）===\n`);

  for (const acc of TARGETS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${acc.name} (${acc.id})`);
    console.log(`${'='.repeat(60)}`);

    // 1. 日別レポート取得
    interface CampDay { date: string; cv: number; spend: number; cpa: number; cpc: number; impressions: number; }
    const campDays = new Map<string, CampDay[]>();

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
          const campId = row.dimensions?.campaign_id;
          const spend = parseFloat(row.metrics?.spend || '0');
          if (spend < 100) continue;
          if (!campDays.has(campId)) campDays.set(campId, []);
          campDays.get(campId)!.push({
            date: row.dimensions?.stat_time_day?.split(' ')[0] || '',
            cv: parseInt(row.metrics?.conversion || '0'),
            spend, cpa: parseFloat(row.metrics?.cost_per_conversion || '0'),
            cpc: parseFloat(row.metrics?.cpc || '0'),
            impressions: parseInt(row.metrics?.impressions || '0'),
          });
        }
        if (list.length < 1000) break;
        page++;
      }
    }

    // 2. キャンペーン情報
    const campIds = [...campDays.keys()];
    const campNames = new Map<string, string>();
    const campStatus = new Map<string, string>();

    for (let i = 0; i < campIds.length; i += 100) {
      const batch = campIds.slice(i, i + 100);
      const cr = await get('/v1.3/campaign/get/', {
        advertiser_id: acc.id,
        filtering: JSON.stringify({ campaign_ids: batch }),
        fields: JSON.stringify(['campaign_id', 'campaign_name', 'operation_status', 'secondary_status']),
        page_size: '100',
      });
      for (const c of cr.data?.list || []) {
        campNames.set(c.campaign_id, c.campaign_name || '');
        campStatus.set(c.campaign_id, c.operation_status || c.secondary_status || '不明');
      }
    }

    // 3. Smart+広告の動画情報
    interface AdInfo { adId: string; adName: string; campaignId: string; crCount: number; videoIds: string[]; status: string; }
    const smartAds: AdInfo[] = [];

    let adPage = 1;
    while (true) {
      const adR = await get('/v1.3/smart_plus/ad/get/', {
        advertiser_id: acc.id,
        fields: JSON.stringify(['smart_plus_ad_id', 'ad_name', 'campaign_id', 'creative_list', 'operation_status']),
        page_size: '100', page: String(adPage),
      });
      if (adR.code !== 0) break;
      for (const ad of adR.data?.list || []) {
        const videoIds = (ad.creative_list || []).map((cr: any) => cr.video_id).filter(Boolean);
        smartAds.push({
          adId: ad.smart_plus_ad_id, adName: ad.ad_name || '',
          campaignId: ad.campaign_id, crCount: ad.creative_list?.length || 0,
          videoIds, status: ad.operation_status || '不明',
        });
      }
      if ((adR.data?.list || []).length < 100) break;
      adPage++;
    }

    // 4. キャンペーンごとの成績集計
    interface CampSummary {
      campId: string; name: string; status: string;
      totalCv: number; totalSpend: number; avgCpa: number;
      maxDayCv: number; maxDayDate: string;
      days: number; crCount: number; videoIds: string[];
      first2DayCv: number; firstDayCpa: number; firstDayCpc: number;
      lastDate: string;
      adId: string;
    }

    const summaries: CampSummary[] = [];

    for (const [campId, days] of campDays) {
      const name = campNames.get(campId) || campId;
      const status = campStatus.get(campId) || '不明';
      const totalCv = days.reduce((s, d) => s + d.cv, 0);
      const totalSpend = days.reduce((s, d) => s + d.spend, 0);
      const avgCpa = totalCv > 0 ? totalSpend / totalCv : 0;
      const maxDay = days.reduce((p, d) => d.cv > p.cv ? d : p, days[0]);
      const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
      const first2DayCv = (sorted[0]?.cv || 0) + (sorted[1]?.cv || 0);
      const firstDayCpa = sorted[0]?.cv > 0 ? sorted[0].cpa : 0;
      const firstDayCpc = sorted[0]?.cpc || 0;
      const lastDate = sorted[sorted.length - 1]?.date || '';

      const ad = smartAds.find(a => a.campaignId === campId);

      summaries.push({
        campId, name, status, totalCv, totalSpend, avgCpa,
        maxDayCv: maxDay.cv, maxDayDate: maxDay.date,
        days: days.length, crCount: ad?.crCount || 0, videoIds: ad?.videoIds || [],
        first2DayCv, firstDayCpa, firstDayCpc, lastDate,
        adId: ad?.adId || '',
      });
    }

    // 5. スパイク実績ありのキャンペーン（再出稿候補）
    console.log('\n【スパイク実績あり（最大日CV ≥ 15）】');
    const spiked = summaries.filter(s => s.maxDayCv >= 15).sort((a, b) => b.maxDayCv - a.maxDayCv);

    if (spiked.length === 0) {
      console.log('  なし');
    } else {
      for (const s of spiked) {
        const statusEmoji = s.status.includes('ENABLE') ? '配信中' : s.status.includes('DISABLE') ? '停止中' : s.status;
        console.log(`\n  ★ ${s.name}`);
        console.log(`    最大日CV: ${s.maxDayCv} (${s.maxDayDate}) | 合計: ${s.totalCv}CV / ¥${Math.round(s.totalSpend).toLocaleString()}`);
        console.log(`    平均CPA: ¥${Math.round(s.avgCpa).toLocaleString()} | 初日CPA: ¥${s.firstDayCpa > 0 ? Math.round(s.firstDayCpa).toLocaleString() : '-'} | 初日CPC: ¥${Math.round(s.firstDayCpc)}`);
        console.log(`    CR数: ${s.crCount}本 | 配信日数: ${s.days}日 | 最終配信: ${s.lastDate}`);
        console.log(`    状態: ${statusEmoji} | campId: ${s.campId} | adId: ${s.adId}`);
        console.log(`    動画ID: ${s.videoIds.length > 0 ? s.videoIds.join(', ') : 'なし'}`);
      }
    }

    // 6. 初速が良かったが短命だったキャンペーン（隠れた当たり候補）
    console.log('\n\n【初速良好だが短命（2日間CV ≥ 8、配信5日以内）】');
    const earlyGood = summaries
      .filter(s => s.first2DayCv >= 8 && s.days <= 5 && s.maxDayCv < 15)
      .sort((a, b) => b.first2DayCv - a.first2DayCv);

    if (earlyGood.length === 0) {
      console.log('  なし');
    } else {
      for (const s of earlyGood) {
        console.log(`  ${s.name}`);
        console.log(`    2日間CV: ${s.first2DayCv} | 初日CPA: ¥${s.firstDayCpa > 0 ? Math.round(s.firstDayCpa).toLocaleString() : '-'} | 合計${s.totalCv}CV | CR${s.crCount}本 | adId: ${s.adId}`);
      }
    }

    // 7. CPA優秀キャンペーン（CPA ≤ ¥2,500 かつ CV ≥ 5）
    console.log('\n\n【CPA優秀（平均CPA ≤ ¥2,500、合計CV ≥ 5）】');
    const cpaGood = summaries
      .filter(s => s.avgCpa > 0 && s.avgCpa <= 2500 && s.totalCv >= 5)
      .sort((a, b) => a.avgCpa - b.avgCpa);

    if (cpaGood.length === 0) {
      console.log('  なし');
    } else {
      for (const s of cpaGood) {
        console.log(`  ${s.name}`);
        console.log(`    平均CPA: ¥${Math.round(s.avgCpa).toLocaleString()} | 合計${s.totalCv}CV | 最大日${s.maxDayCv}CV | CR${s.crCount}本 | adId: ${s.adId}`);
      }
    }

    // 8. 動画IDの重複チェック（同じ動画が別キャンペーンで使われているか）
    console.log('\n\n【動画の再利用状況】');
    const videoUsage = new Map<string, string[]>();
    for (const s of summaries) {
      for (const vid of s.videoIds) {
        if (!videoUsage.has(vid)) videoUsage.set(vid, []);
        videoUsage.get(vid)!.push(s.name);
      }
    }
    const multiUse = [...videoUsage.entries()].filter(([, camps]) => camps.length >= 2);
    if (multiUse.length > 0) {
      console.log(`  ${multiUse.length}本の動画が複数キャンペーンで使用中`);
    } else {
      console.log('  重複使用なし');
    }
  }

  // 9. クロスアカウント：AI_1のスパイクCRがAI_2にあるか、逆も
  console.log(`\n\n${'='.repeat(60)}`);
  console.log('クロスアカウント分析：片方でスパイク→もう片方に未展開？');
  console.log(`${'='.repeat(60)}\n`);

  // CR名（/の3セグメント目）でマッチング
  for (const acc of TARGETS) {
    // このアカウントのスパイクCR名を抽出
    // 既に出力済みなので、ここではサマリーだけ
  }

  console.log('\n=== 完了 ===');
}

main().catch(console.error);
