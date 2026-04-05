import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const BASE = 'https://business-api.tiktok.com/open_api';
const TOKEN = process.env.TIKTOK_ACCESS_TOKEN;
const ADV = '7580666710525493255';

async function api(ep: string, body: any) {
  const r = await fetch(`${BASE}${ep}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': TOKEN! },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  console.log(`${ep}: code=${d.code}, msg=${d.message}`);
  return d;
}

async function main() {
  // テスト用キャンペーンを停止
  const testCampaignId = '1860809958308898';
  await api('/v1.3/smart_plus/campaign/update/', {
    advertiser_id: ADV,
    campaign_id: testCampaignId,
    operation_status: 'DISABLE',
  });
  console.log('テストキャンペーン停止完了');
}

main().catch(console.error);
