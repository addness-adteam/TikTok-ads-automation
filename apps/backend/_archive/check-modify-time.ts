import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

const ACCOUNTS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
  { id: '7543540100849156112', name: 'SNS2' },
];

async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

async function main() {
  console.log('=== ¥300,000 広告グループの最終更新時刻 ===\n');

  for (const acc of ACCOUNTS) {
    let page = 1;
    while (true) {
      const resp = await get('/v1.3/adgroup/get/', {
        advertiser_id: acc.id,
        filtering: JSON.stringify({ status: 'ADGROUP_STATUS_DELIVERY_OK' }),
        fields: JSON.stringify(['adgroup_id', 'adgroup_name', 'budget', 'modify_time', 'create_time']),
        page_size: '100', page: String(page),
      });
      if (resp.code !== 0) break;
      for (const ag of resp.data?.list || []) {
        if (ag.budget >= 30000) {
          // modify_timeをJSTに変換
          const modifyUtc = ag.modify_time || '';
          const createUtc = ag.create_time || '';
          console.log(`${acc.name} | ¥${ag.budget.toLocaleString().padStart(8)} | modified: ${modifyUtc} | created: ${createUtc} | ${ag.adgroup_name}`);
        }
      }
      if ((resp.data?.list || []).length < 100) break;
      page++;
    }
  }
}
main();
