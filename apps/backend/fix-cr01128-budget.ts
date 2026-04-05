import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const ADV_ID = '7580666710525493255';
const CAMPAIGN_ID = '1860808210689201';
const ADGROUP_ID = '1860808255940066';

async function tiktokApi(endpoint: string, body: any): Promise<any> {
  console.log(`API: ${endpoint}`);
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  console.log(JSON.stringify(data, null, 2));
  return data;
}

async function main() {
  // 1. 広告グループに日予算を設定
  console.log('=== 広告グループに日予算3000円を設定 ===');
  await tiktokApi('/v1.3/smart_plus/adgroup/update/', {
    advertiser_id: ADV_ID,
    adgroup_id: ADGROUP_ID,
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
    budget: 3000,
  });

  // 2. キャンペーンを無制限に変更
  console.log('\n=== キャンペーンを無制限予算に変更 ===');
  await tiktokApi('/v1.3/smart_plus/campaign/update/', {
    advertiser_id: ADV_ID,
    campaign_id: CAMPAIGN_ID,
    budget_mode: 'BUDGET_MODE_INFINITE',
  });
}

main().catch(console.error);
