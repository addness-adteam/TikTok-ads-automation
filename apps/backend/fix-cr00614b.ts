import axios from 'axios';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';

async function main() {
  const resp = await axios.post('https://business-api.tiktok.com/open_api/v1.3/smart_plus/adgroup/update/', {
    advertiser_id: SP1,
    adgroup_id: '1862150030125057',
    budget: 6500,
  }, { headers: { 'Access-Token': ACCESS_TOKEN } });
  console.log('result:', resp.data.code === 0 ? `OK budget=${resp.data.data?.budget}` : JSON.stringify(resp.data));
}
main().catch(console.error);
