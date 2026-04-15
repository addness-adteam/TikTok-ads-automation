import axios from 'axios';
const T = 'https://business-api.tiktok.com/open_api';
const K = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

async function main() {
  const r2 = await axios.get(`${T}/v1.3/smart_plus/campaign/get/`, {
    headers: { 'Access-Token': K },
    params: { advertiser_id: '7474920444831875080', page_size: 50 },
  });
  const camps = r2.data?.data?.list || [];
  for (const c of camps) {
    if (c.campaign_name?.includes('CR00468')) {
      console.log('Campaign:', JSON.stringify(c, null, 2));
      const r3 = await axios.get(`${T}/v1.3/smart_plus/adgroup/get/`, {
        headers: { 'Access-Token': K },
        params: {
          advertiser_id: '7474920444831875080',
          filtering: JSON.stringify({ campaign_ids: [String(c.campaign_id)] }),
        },
      });
      console.log('\nAdGroups:', JSON.stringify(r3.data?.data?.list, null, 2));
    }
  }
}
main().catch(e => console.error(e.response?.data || e.message));
