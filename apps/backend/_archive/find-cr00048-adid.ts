import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const AI3 = '7543540647266074641';

async function main() {
  const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: AI3,
      page_size: 10,
      filtering: JSON.stringify({ campaign_ids: ['1851739065362529'] }),
    },
  });
  const ads = resp.data.data?.list || [];
  for (const ad of ads) {
    console.log(`ad_id: ${ad.ad_id} | ${ad.ad_name} | ${ad.operation_status}`);
  }
}

main().catch(console.error);
