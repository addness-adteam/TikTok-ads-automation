const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

async function getAudiences(advId: string, name: string) {
  const resp = await fetch(`${BASE}/v1.3/dmp/custom_audience/list/?advertiser_id=${advId}&page_size=100`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const data = await resp.json();
  console.log(`\n=== ${name} (${advId}) ===`);
  for (const aud of (data.data?.list || [])) {
    if (aud.name?.includes('債務') || aud.name?.includes('除外') || aud.name?.includes('lookalike') || aud.name?.includes('類似')) {
      console.log(`  ID: ${aud.custom_audience_id} | Name: ${aud.name} | Type: ${aud.audience_type} | Size: ${aud.audience_size}`);
    }
  }
  // show all for reference
  console.log(`  --- 全オーディエンス ---`);
  for (const aud of (data.data?.list || [])) {
    console.log(`  ID: ${aud.custom_audience_id} | ${aud.name} | ${aud.audience_type}`);
  }
}

async function main() {
  await getAudiences('7468288053866561553', 'AI_1');
  await getAudiences('7523128243466551303', 'AI_2');
  await getAudiences('7543540647266074641', 'AI_3');
}
main();
