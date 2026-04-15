import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const AI1 = '7468288053866561553';
const AI2 = '7523128243466551303';

async function searchAds(advertiserId: string, advName: string) {
  // ad listから CR01207 を含む広告を検索
  const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: advertiserId,
      page_size: 100,
      filtering: JSON.stringify({}),
      fields: JSON.stringify(['ad_id', 'ad_name', 'operation_status', 'campaign_id', 'adgroup_id', 'create_time', 'modify_time']),
    },
  });

  const ads = resp.data.data?.list || [];
  const matched = ads.filter((a: any) => a.ad_name?.includes('CR01207'));

  console.log(`\n=== ${advName} (${advertiserId}) - ${matched.length} matches out of ${ads.length} total ===`);
  for (const ad of matched) {
    console.log(`  ad_id: ${ad.ad_id}`);
    console.log(`  name: ${ad.ad_name}`);
    console.log(`  status: ${ad.operation_status}`);
    console.log(`  campaign_id: ${ad.campaign_id}`);
    console.log(`  created: ${ad.create_time}`);
    console.log(`  modified: ${ad.modify_time}`);
    console.log('');
  }

  // Smart+ adsも検索
  const spResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: advertiserId,
      page_size: 100,
    },
  });

  const spAds = spResp.data.data?.list || [];
  const spMatched = spAds.filter((a: any) => a.ad_name?.includes('CR01207'));

  if (spMatched.length > 0) {
    console.log(`  [Smart+] ${spMatched.length} matches:`);
    for (const ad of spMatched) {
      console.log(`  ad_id: ${ad.ad_id} | ${ad.ad_name} | status: ${ad.operation_status}`);
    }
  }
}

async function main() {
  await searchAds(AI1, 'AI_1');
  await searchAds(AI2, 'AI_2');
}

main().catch(console.error);
