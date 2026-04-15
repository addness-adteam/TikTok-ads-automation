import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const ADV = '7468288053866561553'; // AI_1

async function api(ep: string, body: any): Promise<any> {
  const r = await fetch(BASE + ep, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN }, body: JSON.stringify(body) });
  return r.json();
}
async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (await fetch(BASE + ep + '?' + qs, { headers: { 'Access-Token': ACCESS_TOKEN } })).json();
}

async function main() {
  console.log('=== Smart+ adgroup作成直後の通常API予算テス�� ===\n');

  // テスト用キャンペーン作成
  const camp = await api('/v1.3/smart_plus/campaign/create/', {
    advertiser_id: ADV, campaign_name: 'TEST_BUDGET_CHECK_DELETE_ME',
    objective_type: 'LEAD_GENERATION', budget_mode: 'BUDGET_MODE_INFINITE', budget_optimize_on: false,
    request_id: Date.now() + '' + Math.floor(Math.random() * 100000),
  });
  const campId = String(camp.data.campaign_id);
  console.log('キャンペーン:', campId);

  // 広告グループ作成（budget: 3000）
  const ag = await api('/v1.3/smart_plus/adgroup/create/', {
    advertiser_id: ADV, campaign_id: campId, adgroup_name: 'TEST_BUDGET_3000',
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET', budget: 3000,
    billing_event: 'OCPM', bid_type: 'BID_TYPE_NO_BID',
    optimization_goal: 'CONVERT', optimization_event: 'ON_WEB_REGISTER',
    pixel_id: '7395091852346654737',
    promotion_type: 'LEAD_GENERATION', promotion_target_type: 'EXTERNAL_WEBSITE',
    placement_type: 'PLACEMENT_TYPE_NORMAL', placements: ['PLACEMENT_TIKTOK'],
    schedule_type: 'SCHEDULE_FROM_NOW',
    schedule_start_time: '2026-04-09 15:00:00',
    targeting_optimization_mode: 'MANUAL',
    targeting_spec: { location_ids: ['1861060'], age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'] },
    request_id: Date.now() + '' + Math.floor(Math.random() * 100000),
  });
  const agId = String(ag.data.adgroup_id);
  console.log('広告グループ:', agId);

  // 即座に両APIで予算を確認
  const spResp = await get('/v1.3/smart_plus/adgroup/get/', { advertiser_id: ADV, adgroup_ids: JSON.stringify([agId]) });
  const normalResp = await get('/v1.3/adgroup/get/', { advertiser_id: ADV, filtering: JSON.stringify({ adgroup_ids: [agId] }), fields: JSON.stringify(['adgroup_id', 'budget', 'budget_mode']) });

  console.log('\n作成直後:');
  console.log('  Smart+ API budget:', spResp.data?.list?.[0]?.budget);
  console.log('  通常 API budget:', normalResp.data?.list?.[0]?.budget);
  console.log('  通常 API budget_mode:', normalResp.data?.list?.[0]?.budget_mode);

  // テストキャンペーン停止
  await api('/v1.3/smart_plus/campaign/status/update/', {
    advertiser_id: ADV, campaign_ids: [campId], operation_status: 'DISABLE',
  });
  console.log('\nテストキャンペーン停止済み');
}
main();
