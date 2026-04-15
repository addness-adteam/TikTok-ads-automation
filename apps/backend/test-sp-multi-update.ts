import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const ADV = '7468288053866561553';
const AG_ID = '1861971960337537';

async function main() {
  const steps = [5070, 6591, 8568, 11138, 14479, 18823];
  
  for (const budget of steps) {
    await fetch(`${BASE}/v1.3/smart_plus/adgroup/update/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
      body: JSON.stringify({ advertiser_id: ADV, adgroup_id: AG_ID, budget }),
    });
    
    const normal = await (await fetch(`${BASE}/v1.3/adgroup/get/?advertiser_id=${ADV}&filtering={"adgroup_ids":["${AG_ID}"]}&fields=["adgroup_id","budget"]`, { headers: { 'Access-Token': ACCESS_TOKEN } })).json();
    console.log(`SP→¥${budget} | 通常API: ¥${normal.data?.list?.[0]?.budget}`);
  }

  // リセット（¥3000に戻す）
  await fetch(`${BASE}/v1.3/smart_plus/adgroup/update/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify({ advertiser_id: ADV, adgroup_id: AG_ID, budget: 3000 }),
  });
  const after = await (await fetch(`${BASE}/v1.3/adgroup/get/?advertiser_id=${ADV}&filtering={"adgroup_ids":["${AG_ID}"]}&fields=["adgroup_id","budget"]`, { headers: { 'Access-Token': ACCESS_TOKEN } })).json();
  console.log(`\nSP→¥3000(リセット) | 通常API: ¥${after.data?.list?.[0]?.budget}`);

  // テストキャンペーン削除
  await fetch(`${BASE}/v1.3/smart_plus/campaign/status/update/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify({ advertiser_id: ADV, campaign_ids: ['1861971960337521'], operation_status: 'DISABLE' }),
  });
}
main();
