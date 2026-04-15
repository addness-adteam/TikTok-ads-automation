import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';

async function main() {
  // CR00614の広告グループ予算を5000に更新
  const resp = await axios.post(
    'https://business-api.tiktok.com/open_api/v1.3/smart_plus/adgroup/update/',
    {
      advertiser_id: SP1,
      adgroup_id: '1862150030125057',
      budget: 5000,
    },
    { headers: { 'Access-Token': ACCESS_TOKEN } },
  );
  console.log('Smart+ update:', JSON.stringify(resp.data));

  // 念のため通常APIでも試す
  if (resp.data.code !== 0) {
    const resp2 = await axios.post(
      'https://business-api.tiktok.com/open_api/v1.3/adgroup/update/',
      {
        advertiser_id: SP1,
        adgroup_id: '1862150030125057',
        budget: 5000,
      },
      { headers: { 'Access-Token': ACCESS_TOKEN } },
    );
    console.log('通常API update:', JSON.stringify(resp2.data));
  }

  // 確認
  const check = await axios.get('https://business-api.tiktok.com/open_api/v1.3/adgroup/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: SP1,
      filtering: JSON.stringify({ adgroup_ids: ['1862150030125057'] }),
    },
  });
  const ag = check.data.data?.list?.[0];
  console.log(`\n確認: budget=${ag?.budget}, mode=${ag?.budget_mode}`);
}

main().catch(console.error);
