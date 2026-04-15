import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const ADV = '7468288053866561553';
const AG_ID = '1861971960337537'; // テスト用

async function main() {
  // 現在の値
  const before = await (await fetch(`${BASE}/v1.3/adgroup/get/?advertiser_id=${ADV}&filtering={"adgroup_ids":["${AG_ID}"]}&fields=["adgroup_id","budget"]`, { headers: { 'Access-Token': ACCESS_TOKEN } })).json();
  console.log('更新前 通常API:', before.data?.list?.[0]?.budget);

  // Smart+ APIで¥3900に更新
  console.log('\nSmart+ APIで¥3900に更新...');
  const updateResp = await fetch(`${BASE}/v1.3/smart_plus/adgroup/update/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify({ advertiser_id: ADV, adgroup_id: AG_ID, budget: 3900 }),
  });
  const updateData = await updateResp.json();
  console.log('Smart+ update result:', updateData.code, updateData.message);

  // 即座に通常APIで確認
  const after1 = await (await fetch(`${BASE}/v1.3/adgroup/get/?advertiser_id=${ADV}&filtering={"adgroup_ids":["${AG_ID}"]}&fields=["adgroup_id","budget"]`, { headers: { 'Access-Token': ACCESS_TOKEN } })).json();
  console.log('\n更新直後 通常API:', after1.data?.list?.[0]?.budget);

  // 3秒待って再確認
  await new Promise(r => setTimeout(r, 3000));
  const after2 = await (await fetch(`${BASE}/v1.3/adgroup/get/?advertiser_id=${ADV}&filtering={"adgroup_ids":["${AG_ID}"]}&fields=["adgroup_id","budget"]`, { headers: { 'Access-Token': ACCESS_TOKEN } })).json();
  console.log('3秒後 通常API:', after2.data?.list?.[0]?.budget);

  // Smart+ APIでも確認
  const spAfter = await (await fetch(`${BASE}/v1.3/smart_plus/adgroup/get/?advertiser_id=${ADV}&adgroup_ids=["${AG_ID}"]`, { headers: { 'Access-Token': ACCESS_TOKEN } })).json();
  console.log('Smart+ API:', spAfter.data?.list?.[0]?.budget);
}
main();
