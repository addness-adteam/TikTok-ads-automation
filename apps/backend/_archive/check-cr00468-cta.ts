import axios from 'axios';
async function main() {
  const r = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
    headers: { 'Access-Token': '2092744b8976b4b9392e0c8e8bdf2bf09570bb82' },
    params: { advertiser_id: '7474920444831875080', page_size: 50 },
  });
  const ad = (r.data?.data?.list || []).find((a: any) => a.ad_name?.includes('CR00468'));
  console.log('call_to_action_list:', JSON.stringify(ad?.call_to_action_list));
  // 全フィールドキー一覧
  console.log('\nAll keys:', Object.keys(ad || {}));
}
main().catch(e => console.error(e.message));
