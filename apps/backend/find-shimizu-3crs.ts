const TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const API_BASE = 'https://business-api.tiktok.com/open_api';

const ACCOUNTS = [
  { name: 'AI_1', id: '7468288053866561553' },
  { name: 'AI_2', id: '7523128243466551303' },
  { name: 'AI_3', id: '7543540647266074641' },
  { name: 'AI_4', id: '7580666710525493255' },
  { name: 'SNS1', id: '7247073333517238273' },
  { name: 'SNS2', id: '7543540100849156112' },
  { name: 'SNS3', id: '7543540381615800337' },
  { name: 'SP1', id: '7474920444831875080' },
  { name: 'SP2', id: '7592868952431362066' },
  { name: 'SP3', id: '7616545514662051858' },
];
const CRs = ['CR00609','CR00616','CR00617'];

async function scan(endpoint: string, acc: {name:string, id:string}) {
  let page = 1;
  const found: any[] = [];
  const isSP = endpoint.includes('smart_plus');
  while (true) {
    const qs = new URLSearchParams({
      advertiser_id: acc.id,
      fields: JSON.stringify(isSP ? ['smart_plus_ad_id','ad_name','operation_status','campaign_id','adgroup_id','create_time'] : ['ad_id','ad_name','operation_status','campaign_id','adgroup_id','create_time']),
      page_size: isSP ? '100' : '1000',
      page: String(page),
    });
    const r = await fetch(`${API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': TOKEN } });
    const d: any = await r.json();
    if (d.code !== 0) break;
    const list = d.data?.list || [];
    for (const ad of list) {
      for (const cr of CRs) {
        if ((ad.ad_name || '').includes(cr) && (ad.ad_name || '').includes('清水絢吾')) {
          found.push({ acc: acc.name, accId: acc.id, endpoint, ad_id: ad.ad_id || ad.smart_plus_ad_id, ad_name: ad.ad_name, status: ad.operation_status, campaign_id: ad.campaign_id, adgroup_id: ad.adgroup_id });
        }
      }
    }
    const size = isSP ? 100 : 1000;
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
      console.log(`${ad.acc} | ${ad.endpoint.includes('smart_plus')?'SP':'REG'} | ${ad.ad_id} | ${ad.status} | camp:${ad.campaign_id} | ${ad.ad_name}`);
    }
  }
}
main();
