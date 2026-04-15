import axios from 'axios';
const T = 'https://business-api.tiktok.com/open_api';
const K = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
async function main() {
  const r = await axios.get(`${T}/v1.3/smart_plus/ad/get/`, {
    headers: { 'Access-Token': K },
    params: { advertiser_id: '7474920444831875080', page_size: 50 },
  });
  const ad = (r.data?.data?.list || []).find((a: any) => a.ad_name?.includes('CR00468'));
  if (!ad) { console.log('not found'); return; }
  // 最初のcreativeの構造を表示
  console.log('creative_list[0]:', JSON.stringify(ad.creative_list?.[0], null, 2));
  console.log('\ncreative_list[1]:', JSON.stringify(ad.creative_list?.[1], null, 2));
}
main().catch(e => console.error(e.response?.data || e.message));
