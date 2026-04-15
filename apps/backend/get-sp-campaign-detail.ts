import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';
const CAMPAIGN_ID = '1858931396653250';

async function tiktokGet(endpoint: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const resp = await fetch(`https://business-api.tiktok.com/open_api${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  // Smart+キャンペーン詳細
  console.log('=== Smart+キャンペーン詳細 ===');
  const r = await tiktokGet('/v1.3/smart_plus/campaign/get/', {
    advertiser_id: SP1,
    filtering: JSON.stringify({ campaign_ids: [CAMPAIGN_ID] }),
  });
  if (r.code === 0 && r.data?.list?.[0]) {
    console.log(JSON.stringify(r.data.list[0], null, 2));
  }

  // 広告グループ情報
  console.log('\n=== 広告グループ ===');
  const ag = await tiktokGet('/v1.3/adgroup/get/', {
    advertiser_id: SP1,
    filtering: JSON.stringify({ campaign_ids: [CAMPAIGN_ID] }),
    fields: JSON.stringify(['adgroup_id', 'adgroup_name', 'optimization_goal', 'deep_external_action', 'pixel_id', 'identity_id', 'identity_type', 'age_groups', 'gender', 'placement_type', 'placements', 'budget', 'budget_mode', 'schedule_start_time', 'schedule_end_time', 'targeting_optimization_mode']),
    page_size: '100',
  });
  if (ag.code === 0 && ag.data?.list) {
    for (const g of ag.data.list) {
      console.log(JSON.stringify(g, null, 2));
    }
  }

  // 広告情報（creative含む）
  console.log('\n=== 広告 ===');
  const ads = await tiktokGet('/v1.3/ad/get/', {
    advertiser_id: SP1,
    filtering: JSON.stringify({ campaign_ids: [CAMPAIGN_ID] }),
    fields: JSON.stringify(['ad_id', 'ad_name', 'ad_text', 'video_id', 'image_ids', 'creative_type', 'call_to_action', 'landing_page_url', 'identity_id', 'identity_type', 'creative_authorized']),
    page_size: '100',
  });
  if (ads.code === 0 && ads.data?.list) {
    for (const a of ads.data.list) {
      console.log(JSON.stringify(a, null, 2));
    }
  } else {
    console.log('通常広告なし（Smart+のcreative_listを確認）');
  }

  // Smart+ ad詳細（creative_list含む）
  console.log('\n=== Smart+ Ad詳細 ===');
  const spAd = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: SP1,
    campaign_id: CAMPAIGN_ID,
  });
  console.log(JSON.stringify(spAd, null, 2));
}
main();
