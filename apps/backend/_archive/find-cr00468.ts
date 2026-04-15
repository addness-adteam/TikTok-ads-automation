import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';

async function tiktokGet(endpoint: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  let page = 1;
  while (true) {
    const resp = await tiktokGet('/v1.3/ad/get/', {
      advertiser_id: SP1,
      fields: JSON.stringify(['ad_id', 'ad_name', 'operation_status', 'campaign_id', 'adgroup_id']),
      page_size: '100',
      page: String(page),
    });
    if (resp.code !== 0) break;
    const list = resp.data?.list || [];
    for (const ad of list) {
      if ((ad.ad_name || '').includes('CR00468')) {
        console.log(`ad_id: ${ad.ad_id}`);
        console.log(`ad_name: ${ad.ad_name}`);
        console.log(`status: ${ad.operation_status}`);
        console.log(`campaign_id: ${ad.campaign_id}`);
        console.log(`adgroup_id: ${ad.adgroup_id}`);
        console.log('');
      }
    }
    if (list.length < 100) break;
    page++;
  }
}
main();
