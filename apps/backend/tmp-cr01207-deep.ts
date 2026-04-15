/**
 * CR01207がなぜ停止されたか、V2と同じロジックで完全再現
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const ADV_ID = '7523128243466551303'; // AI_2
const CAMP_ID = '1862060201804930';

async function tiktokGet(ep: string, params: Record<string, any>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

function jstDate(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')}`;
}

async function main() {
  const now = new Date();
  const today = jstDate(now);
  const sevenDaysAgo = jstDate(new Date(now.getTime() - 7 * 86400000));

  console.log('=== CR01207 停止原因の完全調査 ===\n');

  // 1. Smart+ API で見える広告
  console.log('【1. Smart+ ad/get の結果】');
  const spResp = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: ADV_ID,
    fields: JSON.stringify(['smart_plus_ad_id', 'ad_name', 'campaign_id', 'operation_status', 'creative_list']),
    page_size: '100',
  });
  for (const ad of spResp.data?.list || []) {
    if (ad.campaign_id === CAMP_ID) {
      console.log(`  Smart+ adId: ${ad.smart_plus_ad_id}`);
      console.log(`  name: ${ad.ad_name}`);
      console.log(`  status: ${ad.operation_status}`);
      console.log(`  creative_list: ${ad.creative_list?.length || 0}本`);
    }
  }

  // 2. 通常 ad/get で見える広告（このキャンペーン内）
  console.log('\n【2. 通常 ad/get の結果（campaign_id フィルタ）】');
  const normalResp = await tiktokGet('/v1.3/ad/get/', {
    advertiser_id: ADV_ID,
    fields: JSON.stringify(['ad_id', 'ad_name', 'campaign_id', 'adgroup_id', 'operation_status', 'secondary_status']),
    filtering: JSON.stringify({ campaign_ids: [CAMP_ID] }),
    page_size: '100',
  });
  const normalAds = normalResp.data?.list || [];
  console.log(`  件数: ${normalAds.length}`);
  for (const ad of normalAds) {
    console.log(`  adId: ${ad.ad_id} | name: "${ad.ad_name}" | status: ${ad.operation_status}/${ad.secondary_status} | agId: ${ad.adgroup_id}`);
  }

  // 3. 通常広告の7日間メトリクス（ad_id単位）
  console.log('\n【3. 通常広告の7日間メトリクス】');
  if (normalAds.length > 0) {
    const adIds = normalAds.map((a: any) => a.ad_id);
    const metricResp = await tiktokGet('/v1.3/report/integrated/get/', {
      advertiser_id: ADV_ID,
      report_type: 'BASIC',
      data_level: 'AUCTION_AD',
      dimensions: JSON.stringify(['ad_id']),
      metrics: JSON.stringify(['spend', 'conversion', 'impressions', 'clicks']),
      start_date: sevenDaysAgo,
      end_date: today,
      filtering: JSON.stringify([{ field_name: 'ad_ids', filter_type: 'IN', filter_value: JSON.stringify(adIds) }]),
      page_size: '100',
    });
    for (const row of metricResp.data?.list || []) {
      const spend = parseFloat(row.metrics?.spend || '0');
      const cv = parseInt(row.metrics?.conversion || '0');
      const imp = parseInt(row.metrics?.impressions || '0');
      console.log(`  adId: ${row.dimensions?.ad_id} | spend: ¥${Math.round(spend).toLocaleString()} | CV: ${cv} | imp: ${imp.toLocaleString()}`);
    }
    if ((metricResp.data?.list || []).length === 0) {
      console.log('  メトリクスなし');
    }
  }

  // 4. Smart+広告のメトリクス（smart_plus_ad_id単位）
  console.log('\n【4. Smart+広告のメトリクス（campaign_id単位）】');
  const spMetricResp = await tiktokGet('/v1.3/report/integrated/get/', {
    advertiser_id: ADV_ID,
    report_type: 'BASIC',
    data_level: 'AUCTION_CAMPAIGN',
    dimensions: JSON.stringify(['campaign_id']),
    metrics: JSON.stringify(['spend', 'conversion', 'impressions', 'clicks']),
    start_date: sevenDaysAgo,
    end_date: today,
    filtering: JSON.stringify([{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify([CAMP_ID]) }]),
    page_size: '10',
  });
  for (const row of spMetricResp.data?.list || []) {
    console.log(`  campId: ${row.dimensions?.campaign_id} | spend: ¥${parseFloat(row.metrics?.spend || '0').toLocaleString()} | CV: ${row.metrics?.conversion} | imp: ${row.metrics?.impressions}`);
  }

  // 5. V2がこの広告をどう認識するか再現
  console.log('\n【5. V2の認識シミュレーション】');

  // Smart+ ad/getの結果
  const smartPlusAdIds = new Set((spResp.data?.list || []).map((ad: any) => ad.smart_plus_ad_id));
  console.log(`  Smart+ adIds: ${[...smartPlusAdIds].join(', ')}`);

  // 通常ad/getの結果から、Smart+ adIdと一致しないものが「通常広告」として認識される
  const regularAdsForV2 = normalAds.filter((ad: any) => !smartPlusAdIds.has(ad.ad_id));
  console.log(`  通常広告（Smart+ IDと不一致）: ${regularAdsForV2.length}件`);
  for (const ad of regularAdsForV2) {
    console.log(`    adId: ${ad.ad_id} | name: "${ad.ad_name}"`);
  }

  // 6. 広告名パースの結果
  console.log('\n【6. 広告名パース結果】');
  for (const ad of regularAdsForV2) {
    const adName = ad.ad_name || '';
    const parts = adName.split('/');
    if (parts.length >= 4) {
      const lpName = parts[parts.length - 1];
      console.log(`  adId: ${ad.ad_id} | lpName: "${lpName}" | → registrationPath: "TikTok広告-AI-${lpName}"`);
    } else {
      console.log(`  adId: ${ad.ad_id} | パース失敗（${parts.length}パート）: "${adName}"`);
    }
  }

  // 7. 全ENABLEの通常広告数（AI_2全体）
  console.log('\n【7. AI_2の全ENABLE通常広告数】');
  const allNormalResp = await tiktokGet('/v1.3/ad/get/', {
    advertiser_id: ADV_ID,
    fields: JSON.stringify(['ad_id', 'ad_name', 'campaign_id', 'operation_status']),
    filtering: JSON.stringify({ status: 'AD_STATUS_DELIVERY_OK' }),
    page_size: '100',
  });
  const allNormalAds = allNormalResp.data?.list || [];
  console.log(`  全ENABLE通常広告: ${allNormalAds.length}件`);
  const inSmartPlusCamps = allNormalAds.filter((ad: any) => {
    const spCampIds = new Set((spResp.data?.list || []).map((sp: any) => sp.campaign_id));
    return spCampIds.has(ad.campaign_id);
  });
  console.log(`  うちSmart+キャンペーンに属する: ${inSmartPlusCamps.length}件`);
  console.log(`  純粋な通常広告: ${allNormalAds.length - inSmartPlusCamps.length}件`);
}

main().catch(console.error);
