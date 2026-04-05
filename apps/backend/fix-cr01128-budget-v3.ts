import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const BASE = 'https://business-api.tiktok.com/open_api';
const TOKEN = process.env.TIKTOK_ACCESS_TOKEN;
const ADV = '7580666710525493255';
const CAMP = '1860809958308898';
const PIXEL = '7580671757758464018';

async function api(ep: string, body: any) {
  console.log('\nAPI:', ep);
  const r = await fetch(`${BASE}${ep}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': TOKEN! },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  console.log(`code=${d.code}, msg=${d.message}`);
  if (d.data) console.log(JSON.stringify(d.data, null, 2));
  return d;
}

const st = () => new Date(Date.now() + 5*60*1000).toISOString().replace('T',' ').slice(0,19);
const rid = () => String(Date.now()) + String(Math.floor(Math.random()*100000));

async function main() {
  const base = {
    advertiser_id: ADV, campaign_id: CAMP, adgroup_name: '260327 test',
    billing_event: 'OCPM', bid_type: 'BID_TYPE_NO_BID',
    optimization_goal: 'CONVERT', optimization_event: 'ON_WEB_REGISTER',
    pixel_id: PIXEL, promotion_type: 'LEAD_GENERATION',
    promotion_target_type: 'EXTERNAL_WEBSITE',
    schedule_type: 'SCHEDULE_FROM_NOW', schedule_start_time: st(),
    targeting_spec: { location_ids: ['1861060'] },
  };

  // テストA: budget_mode: BUDGET_MODE_DAY
  console.log('=== テストA: adgroup BUDGET_MODE_DAY ===');
  await api('/v1.3/smart_plus/adgroup/create/', { ...base, budget_mode: 'BUDGET_MODE_DAY', budget: 3000, request_id: rid() });

  // テストB: budget_mode省略 + budget指定
  console.log('\n=== テストB: budget_mode省略 + budget:3000 ===');
  await api('/v1.3/smart_plus/adgroup/create/', { ...base, budget: 3000, request_id: rid() });

  // テストC: budget_mode: BUDGET_MODE_INFINITE (adgroupも無制限)
  console.log('\n=== テストC: adgroup BUDGET_MODE_INFINITE (予算なし) ===');
  await api('/v1.3/smart_plus/adgroup/create/', { ...base, budget_mode: 'BUDGET_MODE_INFINITE', request_id: rid() });
}

main().catch(console.error);
