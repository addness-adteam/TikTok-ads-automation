const TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCS = [
  ['AI_1','7468288053866561553'],['AI_2','7523128243466551303'],['AI_3','7543540647266074641'],['AI_4','7580666710525493255'],
  ['SNS1','7247073333517238273'],['SNS2','7543540100849156112'],['SNS3','7543540381615800337'],
  ['SP1','7474920444831875080'],['SP2','7592868952431362066'],['SP3','7616545514662051858'],
];
async function scan(endpoint: string, name: string, id: string) {
  let page = 1;
  const isSP = endpoint.includes('smart_plus');
  while (true) {
    const qs = new URLSearchParams({
      advertiser_id: id,
      fields: JSON.stringify(isSP ? ['smart_plus_ad_id','ad_name','operation_status'] : ['ad_id','ad_name','operation_status']),
      page_size: isSP ? '100':'1000',
      page: String(page),
    });
    const r = await fetch(`${API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': TOKEN } });
    const d: any = await r.json();
    if (d.code !== 0) break;
    const list = d.data?.list || [];
    for (const ad of list) {
      if ((ad.ad_name || '').includes('CR00739') && (ad.ad_name || '').includes('Claude')) {
        console.log(`${name} (${id}) | ${isSP?'SP':'REG'} | ${ad.ad_id || ad.smart_plus_ad_id} | ${ad.operation_status} | ${ad.ad_name}`);
      }
    }
    const size = isSP ? 100 : 1000;
    const total = d.data?.page_info?.total_number || 0;
    if (page * size >= total || list.length === 0) break;
    page++;
  }
}
async function main() {
  for (const [n,i] of ACCS) {
    await scan('/v1.3/ad/get/', n, i);
    await scan('/v1.3/smart_plus/ad/get/', n, i);
  }
}
main();
