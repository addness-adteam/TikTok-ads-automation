import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const fetch = require('node-fetch');
const BASE = 'https://business-api.tiktok.com/open_api';
const TOKEN = process.env.TIKTOK_ACCESS_TOKEN;

async function main() {
  const advId = '7580666710525493255';
  const params = new URLSearchParams({
    advertiser_id: advId,
    page_size: '100',
  });
  const res = await fetch(`${BASE}/v1.3/dmp/custom_audience/list/?${params}`, { headers: { 'Access-Token': TOKEN } });
  const data = await res.json();
  console.log('Total:', data.data?.page_info?.total_number);
  if (data.data?.list) {
    data.data.list.forEach((a: any) => console.log(JSON.stringify({
      id: a.custom_audience_id,
      name: a.name,
      type: a.audience_type,
      size: a.audience_size,
    })));
  }
  
  // Also check with audience_ids field
  console.log('\n--- Raw first entry ---');
  if (data.data?.list?.[0]) {
    console.log(JSON.stringify(data.data.list[0], null, 2));
  }
}
main();
