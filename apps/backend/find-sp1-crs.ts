const TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const API_BASE = 'https://business-api.tiktok.com/open_api';
const SP1 = '7474920444831875080';
const CRs = ['CR00574', 'CR00577'];
async function scan(endpoint: string) {
  let page = 1;
  const isSP = endpoint.includes('smart_plus');
  while (true) {
    const qs = new URLSearchParams({
      advertiser_id: SP1,
      fields: JSON.stringify(isSP ? ['smart_plus_ad_id','ad_name','operation_status'] : ['ad_id','ad_name','operation_status']),
      page_size: isSP ? '100':'1000', page: String(page),
    });
    const r = await fetch(`${API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': TOKEN } });
    const d: any = await r.json();
    if (d.code !== 0) break;
    const list = d.data?.list || [];
    for (const ad of list) {
      for (const cr of CRs) {
        if ((ad.ad_name || '').includes(cr)) {
          console.log(`${isSP?'SP':'REG'} | ${ad.ad_id || ad.smart_plus_ad_id} | ${ad.operation_status} | ${ad.ad_name}`);
        }
      }
    }
    const size = isSP ? 100 : 1000;
    const total = d.data?.page_info?.total_number || 0;
    if (page * size >= total || list.length === 0) break;
    page++;
  }
}
async function main() {
  await scan('/v1.3/ad/get/');
  await scan('/v1.3/smart_plus/ad/get/');
}
main();
