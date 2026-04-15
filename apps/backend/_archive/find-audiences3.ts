const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

async function getDebt(advId: string, name: string) {
  const resp = await fetch(`${BASE}/v1.3/dmp/custom_audience/list/?advertiser_id=${advId}&page_size=100`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const data = await resp.json();
  console.log(`=== ${name} (${advId}) ===`);
  for (const aud of (data.data?.list || [])) {
    if (aud.name?.includes('債務') || aud.name?.includes('年収')) {
      console.log(`  ID: ${aud.audience_id} | ${aud.name} | shared=${aud.shared}`);
    }
  }
}
async function main() {
  await getDebt('7468288053866561553', 'AI_1');
  await getDebt('7523128243466551303', 'AI_2');
  await getDebt('7543540647266074641', 'AI_3');
}
main();
