import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const AI_ACCOUNTS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
  { id: '7580666710525493255', name: 'AI_4' },
];

async function main() {
  for (const acc of AI_ACCOUNTS) {
    // 通常広告
    const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
      headers: { 'Access-Token': ACCESS_TOKEN },
      params: { advertiser_id: acc.id, page_size: 100 },
    });
    const ads = resp.data.data?.list || [];
    const matched = ads.filter((a: any) => a.ad_name?.includes('CR00048'));
    for (const ad of matched) {
      console.log(`[${acc.name}] ad_id: ${ad.ad_id} | ${ad.ad_name} | ${ad.operation_status}`);
    }

    // Smart+
    const spResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
      headers: { 'Access-Token': ACCESS_TOKEN },
      params: { advertiser_id: acc.id, page_size: 100 },
    });
    const spAds = spResp.data.data?.list || [];
    const spMatched = spAds.filter((a: any) => a.ad_name?.includes('CR00048') || a.ad_name?.includes('箕輪'));
    for (const ad of spMatched) {
      console.log(`[${acc.name} SP] campaign: ${ad.campaign_id} | ${ad.ad_name} | ${ad.operation_status}`);
    }
  }
}

main().catch(console.error);
