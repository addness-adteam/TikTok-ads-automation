import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const AI2 = '7523128243466551303';

async function main() {
  // Smart+ ad詳細
  const spResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: AI2,
      page_size: 100,
    },
  });

  const spAds = spResp.data.data?.list || [];
  const matched = spAds.filter((a: any) => a.ad_name?.includes('CR01207'));

  for (const ad of matched) {
    console.log(JSON.stringify(ad, null, 2));
  }
}

main().catch(console.error);
