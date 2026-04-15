import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';

async function main() {
  // CR00614のキャンペーン
  const campResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/campaign/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: SP1,
      filtering: JSON.stringify({ campaign_ids: ['1862150030124113'] }),
    },
  });
  const camp = campResp.data.data?.list?.[0];
  console.log('=== Campaign ===');
  console.log(`name: ${camp?.campaign_name}`);
  console.log(`budget: ${camp?.budget}`);
  console.log(`budget_mode: ${camp?.budget_mode}`);

  // 広告グループ
  const agResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/adgroup/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: SP1,
      filtering: JSON.stringify({ adgroup_ids: ['1862150030125057'] }),
    },
  });
  const ag = agResp.data.data?.list?.[0];
  console.log('\n=== AdGroup ===');
  console.log(`name: ${ag?.adgroup_name}`);
  console.log(`budget: ${ag?.budget}`);
  console.log(`budget_mode: ${ag?.budget_mode}`);

  // 他のCR00613も比較
  const agResp2 = await axios.get('https://business-api.tiktok.com/open_api/v1.3/adgroup/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: SP1,
      filtering: JSON.stringify({ adgroup_ids: ['1862150173126849'] }),
    },
  });
  const ag2 = agResp2.data.data?.list?.[0];
  console.log('\n=== CR00613 AdGroup (比較) ===');
  console.log(`budget: ${ag2?.budget}`);
  console.log(`budget_mode: ${ag2?.budget_mode}`);
}

main().catch(console.error);
