const TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const API_BASE = 'https://business-api.tiktok.com/open_api';

const ACCOUNTS = [
  { name: 'AI_1', id: '7468288053866561553' },
  { name: 'AI_2', id: '7523128243466551303' },
  { name: 'AI_3', id: '7543540647266074641' },
  { name: 'AI_4', id: '7580666710525493255' },
];
const CRs = ['CR01199','CR01200','CR01201','CR01202','CR01203'];

async function scan(endpoint: string, acc: {name:string, id:string}) {
  let page = 1;
  const found: any[] = [];
  while (true) {
    const qs = new URLSearchParams({
      advertiser_id: acc.id,
      fields: JSON.stringify(endpoint.includes('smart_plus') ? ['smart_plus_ad_id','ad_name','operation_status','campaign_id','adgroup_id','create_time'] : ['ad_id','ad_name','operation_status','campaign_id','adgroup_id','create_time']),
      page_size: endpoint.includes('smart_plus') ? '100' : '1000',
      page: String(page),
    });
    const r = await fetch(`${API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': TOKEN } });
    const d: any = await r.json();
    if (d.code !== 0) { console.log(`ERR ${acc.name} ${endpoint}: ${d.message}`); break; }
    const list = d.data?.list || [];
    for (const ad of list) {
      for (const cr of CRs) {
        if ((ad.ad_name || '').includes(cr)) {
          found.push({ acc: acc.name, accId: acc.id, endpoint, ad_id: ad.ad_id || ad.smart_plus_ad_id, ...ad });
        }
      }
    }
    const size = endpoint.includes('smart_plus') ? 100 : 1000;
    const total = d.data?.page_info?.total_number || 0;
    if (page * size >= total || list.length === 0) break;
    page++;
  }
  return found;
}

async function main() {
  for (const acc of ACCOUNTS) {
    const reg = await scan('/v1.3/ad/get/', acc);
    const sp = await scan('/v1.3/smart_plus/ad/get/', acc);
    for (const ad of [...reg, ...sp]) {
      console.log(`${ad.acc} | ${ad.endpoint} | ${ad.ad_id} | ${ad.operation_status} | camp:${ad.campaign_id} adg:${ad.adgroup_id} | ${ad.ad_name}`);
    }
  }
}
main();
