import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const AI2 = '7523128243466551303';

async function main() {
  const spResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: { advertiser_id: AI2, page_size: 100 },
  });

  const spAds = spResp.data.data?.list || [];
  const matched = spAds.filter((a: any) => a.ad_name?.includes('CR01207'));

  for (const ad of matched) {
    console.log(`ad_id: ${ad.ad_id}`);
    console.log(`name: ${ad.ad_name}`);
    console.log(`status: ${ad.operation_status}`);
    console.log(`campaign_id: ${ad.campaign_id}`);
  }
}

main().catch(console.error);
