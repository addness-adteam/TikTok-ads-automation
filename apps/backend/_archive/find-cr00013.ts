const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const AI1 = '7468288053866561553';
const ADGROUP_ID = '1861779191064770';

async function main() {
  // excluded_audience_ids で更新
  console.log('=== 除外オーディエンス設定 ===');
  const resp = await fetch(`${BASE}/v1.3/smart_plus/adgroup/update/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify({
      advertiser_id: AI1,
      adgroup_id: ADGROUP_ID,
      targeting_spec: {
        location_ids: ['1861060'],
        age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'],
        excluded_audience_ids: ['194977234', '194405484'],
      },
    }),
  });
  const data = await resp.json();
  console.log(`code: ${data.code}, message: ${data.message}`);

  // 確認
  await new Promise(r => setTimeout(r, 2000));
  const resp2 = await fetch(`${BASE}/v1.3/smart_plus/adgroup/get/?${new URLSearchParams({
    advertiser_id: AI1, adgroup_ids: JSON.stringify([ADGROUP_ID]),
  })}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  const data2 = await resp2.json();
  const ag = data2.data?.list?.[0];
  console.log(`targeting_optimization_mode: ${ag?.targeting_optimization_mode}`);
  console.log(`age_groups: ${JSON.stringify(ag?.targeting_spec?.age_groups)}`);
  console.log(`excluded_audience_ids: ${JSON.stringify(ag?.targeting_spec?.excluded_audience_ids)}`);
  console.log(`excluded_custom_audience_ids: ${JSON.stringify(ag?.targeting_spec?.excluded_custom_audience_ids)}`);
}

main().catch(console.error);
