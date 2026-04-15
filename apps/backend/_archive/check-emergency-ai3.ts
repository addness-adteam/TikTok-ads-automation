const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const API = 'https://business-api.tiktok.com/open_api';
const AI3 = '7543540647266074641';

async function main() {
  // さっき横展開で作ったad_id: 1862196548006162
  const resp = await fetch(`${API}/v1.3/smart_plus/ad/get/?${new URLSearchParams({
    advertiser_id: AI3,
    filtering: JSON.stringify({ smart_plus_ad_ids: ['1862196548006162'] }),
  })}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  const data = await resp.json() as any;
  const ad = data.data?.list?.[0];
  if (!ad) { console.log('not found'); return; }

  console.log('広告名:', ad.smart_plus_ad_name || ad.ad_name);
  console.log('status:', ad.operation_status);
  const lpUrls = (ad.creative_list?.[0]?.creative_info?.landing_page_urls || []);
  console.log('LP URL:', lpUrls[0] || 'N/A');
}
main().catch(console.error);
