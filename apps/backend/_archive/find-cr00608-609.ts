import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP_ACCOUNTS = [
  { id: '7474920444831875080', name: 'SP1' },
  { id: '7592868952431362066', name: 'SP2' },
  { id: '7616545514662051858', name: 'SP3' },
];

async function main() {
  for (const acc of SP_ACCOUNTS) {
    const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
      headers: { 'Access-Token': ACCESS_TOKEN },
      params: { advertiser_id: acc.id, page_size: 100 },
    });
    const ads = resp.data.data?.list || [];
    const matched = ads.filter((a: any) => a.ad_name?.includes('CR00608') || a.ad_name?.includes('CR00609'));
    if (matched.length > 0) {
      console.log(`\n=== ${acc.name} (${acc.id}) ===`);
      for (const ad of matched) {
        console.log(`  ad_id: ${ad.ad_id} | ${ad.ad_name} | ${ad.operation_status}`);
      }
    }

    const spResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
      headers: { 'Access-Token': ACCESS_TOKEN },
      params: { advertiser_id: acc.id, page_size: 100 },
    });
    const spAds = spResp.data.data?.list || [];
    const spMatched = spAds.filter((a: any) => a.ad_name?.includes('CR00608') || a.ad_name?.includes('CR00609'));
    if (spMatched.length > 0) {
      console.log(`  [Smart+]`);
      for (const ad of spMatched) {
        console.log(`  ad_id: ${ad.ad_id || '(SP親)'} | campaign: ${ad.campaign_id} | ${ad.ad_name} | ${ad.operation_status}`);
      }
    }
  }
}

main().catch(console.error);
