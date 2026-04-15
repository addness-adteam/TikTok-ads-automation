import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

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

const CRs = ['CR01199','CR01200','CR01201','CR01202','CR01203'];

async function main() {
  for (const acc of ACCOUNTS) {
    let page = 1;
    while (true) {
      const qs = new URLSearchParams({
        advertiser_id: acc.id,
        fields: JSON.stringify(['ad_id','ad_name','operation_status']),
        page_size: '100',
        page: String(page),
      });
      const r = await fetch(`${API_BASE}/v1.3/ad/get/?${qs}`, { headers: { 'Access-Token': TOKEN } });
      const d: any = await r.json();
      if (d.code !== 0) { console.log(`${acc.name}: err ${d.message}`); break; }
      const list = d.data?.list || [];
      for (const ad of list) {
        for (const cr of CRs) {
          if ((ad.ad_name || '').includes(cr)) {
            console.log(`${acc.name} (${acc.id}) | ${ad.ad_id} | ${ad.operation_status} | ${ad.ad_name}`);
          }
        }
      }
      if (list.length < 100) break;
      page++;
    }
  }
}
main();
