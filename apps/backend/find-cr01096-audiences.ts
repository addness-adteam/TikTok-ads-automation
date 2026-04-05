import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const fetch = require('node-fetch');
const BASE = 'https://business-api.tiktok.com/open_api';
const TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

async function main() {
  // Find CR01096 in AI_2 and AI_3
  for (const advId of ['7523128243466551303', '7543540647266074641']) {
    const params = new URLSearchParams({
      advertiser_id: advId,
      filtering: JSON.stringify({ ad_name: 'CR01096' }),
      fields: JSON.stringify(['ad_id','ad_name','campaign_id','adgroup_id']),
      page_size: '10',
    });
    const res = await fetch(`${BASE}/v1.3/ad/get/?${params}`, { headers: { 'Access-Token': TOKEN } });
    const data = await res.json();
    if (data.data?.list?.length > 0) {
      console.log('Found CR01096 in advertiser:', advId);
      data.data.list.forEach((a: any) => console.log(JSON.stringify(a)));
    } else {
      console.log(`CR01096 not in ${advId}`);
    }
  }

  // Get audience lists for AI_4
  console.log('\n--- AI_4 Audience Lists ---');
  const advId = '7580666710525493255';
  const params2 = new URLSearchParams({
    advertiser_id: advId,
    page_size: '100',
  });
  const res2 = await fetch(`${BASE}/v1.3/dmp/custom_audience/list/?${params2}`, { headers: { 'Access-Token': TOKEN } });
  const data2 = await res2.json();
  if (data2.data?.list) {
    data2.data.list.forEach((a: any) => console.log(a.custom_audience_id, '|', a.name));
  } else {
    console.log('Audience error:', JSON.stringify(data2));
  }
}
main();
