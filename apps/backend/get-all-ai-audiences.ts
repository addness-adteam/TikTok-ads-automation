import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const fetch = require('node-fetch');
const BASE = 'https://business-api.tiktok.com/open_api';
const TOKEN = process.env.TIKTOK_ACCESS_TOKEN;

async function main() {
  // Check all AI accounts for audiences
  const accounts = [
    { name: 'AI_1', id: '7468288053866561553' },
    { name: 'AI_2', id: '7523128243466551303' },
    { name: 'AI_3', id: '7543540647266074641' },
    { name: 'AI_4', id: '7580666710525493255' },
  ];
  
  for (const acc of accounts) {
    console.log(`\n--- ${acc.name} (${acc.id}) ---`);
    const params = new URLSearchParams({
      advertiser_id: acc.id,
      page_size: '100',
    });
    const res = await fetch(`${BASE}/v1.3/dmp/custom_audience/list/?${params}`, { headers: { 'Access-Token': TOKEN } });
    const data = await res.json();
    if (data.data?.list) {
      data.data.list.forEach((a: any) => console.log(`  ${a.audience_id} | ${a.name} | ${a.audience_type}`));
    }
    console.log(`  Total: ${data.data?.page_info?.total_number}`);
  }
}
main();
