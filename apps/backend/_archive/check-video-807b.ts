const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const ADV_ID = '7468288053866561553';

async function main() {
  // ad/get without status field
  console.log('=== ad/get for deleted ad ===');
  const r = await fetch(`${BASE}/v1.3/ad/get/?advertiser_id=${ADV_ID}&filtering=${JSON.stringify({ad_ids:['1855388992993393']})}&fields=${JSON.stringify(['ad_id','ad_name','video_id','ad_format','landing_page_url'])}`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const d = await r.json();
  console.log(JSON.stringify(d, null, 2).substring(0, 1000));

  // Try video search with different approach
  console.log('\n=== file/video/ad/search POST ===');
  const r2 = await fetch(`${BASE}/v1.3/file/video/ad/search/?advertiser_id=${ADV_ID}`, {
    method: 'GET',
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const d2 = await r2.json();
  // Look for our video in recent videos
  const videos = d2.data?.list || [];
  console.log(`Total videos returned: ${videos.length}`);
  for (const v of videos) {
    if (v.video_id === '7599678317318897671' || v.item_id === '7599678317318897671') {
      console.log('FOUND:', JSON.stringify(v, null, 2));
    }
  }

  // Try smart+ ad get
  console.log('\n=== smart_plus/ad/get for deleted ===');
  const r3 = await fetch(`${BASE}/v1.3/smart_plus/ad/get/?advertiser_id=${ADV_ID}&filtering=${JSON.stringify({smart_plus_ad_ids:['1855388992993393']})}`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const d3 = await r3.json();
  console.log(JSON.stringify(d3, null, 2).substring(0, 1000));
}
main();
