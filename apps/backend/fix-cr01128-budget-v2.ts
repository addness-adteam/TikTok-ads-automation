import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN!;
const ADV_ID = '7580666710525493255';
const PIXEL_ID = '7580671757758464018';

async function tiktokApi(endpoint: string, body: any): Promise<any> {
  console.log(`\nAPI: ${endpoint}`);
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  console.log(`Result: code=${data.code}, message=${data.message}`);
  if (data.data) console.log('Data:', JSON.stringify(data.data, null, 2));
  return data;
}

function scheduleTime(): string {
  const t = new Date(Date.now() + 5 * 60 * 1000);
  return t.toISOString().replace('T', ' ').slice(0, 19);
}

async function tryCreateAdgroup(campaignId: string, label: string): Promise<void> {
  console.log(`\n--- ${label}: adgroup作成テスト ---`);
  await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
    advertiser_id: ADV_ID,
    campaign_id: campaignId,
    adgroup_name: '260327 テスト',
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
    budget: 3000,
    billing_event: 'OCPM',
    bid_type: 'BID_TYPE_NO_BID',
    optimization_goal: 'CONVERT',
    optimization_event: 'ON_WEB_REGISTER',
    pixel_id: PIXEL_ID,
    promotion_type: 'LEAD_GENERATION',
    promotion_target_type: 'EXTERNAL_WEBSITE',
    schedule_type: 'SCHEDULE_FROM_NOW',
    schedule_start_time: scheduleTime(),
    targeting_spec: { location_ids: ['1861060'] },
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
}

async function main() {
  // テスト1: BUDGET_MODE_INFINITE (budget_optimize_on省略)
  console.log('=== テスト1: campaign INFINITE (budget_optimize_on省略) ===');
  const r1 = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
    advertiser_id: ADV_ID,
    campaign_name: 'budget_test_1_infinite_no_cbo',
    objective_type: 'LEAD_GENERATION',
    budget_mode: 'BUDGET_MODE_INFINITE',
    request_id: String(Date.now()) + '1' + String(Math.floor(Math.random() * 100000)),
  });
  if (r1.code === 0) await tryCreateAdgroup(String(r1.data.campaign_id), 'テスト1');

  // テスト2: BUDGET_MODE_INFINITE + budget_optimize_on: true
  console.log('\n=== テスト2: campaign INFINITE + CBO true ===');
  const r2 = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
    advertiser_id: ADV_ID,
    campaign_name: 'budget_test_2_infinite_cbo_true',
    objective_type: 'LEAD_GENERATION',
    budget_mode: 'BUDGET_MODE_INFINITE',
    budget_optimize_on: true,
    request_id: String(Date.now()) + '2' + String(Math.floor(Math.random() * 100000)),
  });
  if (r2.code === 0) await tryCreateAdgroup(String(r2.data.campaign_id), 'テスト2');

  // テスト3: BUDGET_MODE_DAY大きめ + adgroup日予算
  console.log('\n=== テスト3: campaign DAY 100000 + adgroup日予算 ===');
  const r3 = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
    advertiser_id: ADV_ID,
    campaign_name: 'budget_test_3_day_100k',
    objective_type: 'LEAD_GENERATION',
    budget_mode: 'BUDGET_MODE_DAY',
    budget: 100000,
    request_id: String(Date.now()) + '3' + String(Math.floor(Math.random() * 100000)),
  });
  if (r3.code === 0) await tryCreateAdgroup(String(r3.data.campaign_id), 'テスト3');

  console.log('\n=== テスト完了 ===');
  console.log('テストキャンペーンはTikTok管理画面から手動で削除してください');
}

main().catch(console.error);
