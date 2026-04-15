const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

async function main() {
  const resp = await fetch(`${BASE}/v1.3/dmp/custom_audience/list/?advertiser_id=7468288053866561553&page_size=100`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const data = await resp.json();
  // Show first item's keys
  const first = data.data?.list?.[0];
  if (first) {
    console.log('Keys:', Object.keys(first));
    console.log('First item:', JSON.stringify(first, null, 2));
  }
  // Print all with correct ID field
  for (const aud of (data.data?.list || [])) {
    const id = aud.audience_id || aud.custom_audience_id || aud.id;
    console.log(`  ID: ${id} | ${aud.name}`);
  }
}
main();
