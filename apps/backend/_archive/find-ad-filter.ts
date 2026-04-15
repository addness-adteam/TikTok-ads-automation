const TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCOUNTS = [
  { name: 'AI_1', id: '7468288053866561553' },
  { name: 'AI_2', id: '7523128243466551303' },
  { name: 'AI_3', id: '7543540647266074641' },
  { name: 'AI_4', id: '7580666710525493255' },
];
const CRs = ['CR01199','CR01200','CR01201','CR01202','CR01203'];

async function main() {
  for (const acc of ACCOUNTS) {
    for (const cr of CRs) {
      const qs = new URLSearchParams({
        advertiser_id: acc.id,
        filtering: JSON.stringify({ ad_name: cr }),
        fields: JSON.stringify(['ad_id','ad_name','operation_status','campaign_id','adgroup_id']),
        page_size: '20',
      });
      const r = await fetch(`${API_BASE}/v1.3/ad/get/?${qs}`, { headers: { 'Access-Token': TOKEN } });
      const d: any = await r.json();
      const list = d.data?.list || [];
      for (const ad of list) {
        console.log(`${acc.name} | ${ad.ad_id} | ${ad.operation_status} | ${ad.ad_name}`);
      }
    }
  }
}
main();
