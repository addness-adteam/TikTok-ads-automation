const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const ADV_ID = '7468288053866561553';
const VIDEO_ID = '7599678317318897671';

async function main() {
  // 1. video/ad/info
  console.log('=== video/ad/info ===');
  try {
    const r1 = await fetch(`${BASE}/v1.3/file/video/ad/info/?advertiser_id=${ADV_ID}&video_ids=${JSON.stringify([VIDEO_ID])}`, {
      headers: { 'Access-Token': ACCESS_TOKEN },
    });
    const d1 = await r1.json();
    console.log(JSON.stringify(d1, null, 2).substring(0, 500));
  } catch (e: any) { console.log(e.message); }

  // 2. video/ad/search
  console.log('\n=== video/ad/search ===');
  try {
    const r2 = await fetch(`${BASE}/v1.3/file/video/ad/search/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
      body: JSON.stringify({
        advertiser_id: ADV_ID,
        filtering: { video_ids: [VIDEO_ID] },
      }),
    });
    const d2 = await r2.json();
    console.log(JSON.stringify(d2, null, 2).substring(0, 500));
  } catch (e: any) { console.log(e.message); }

  // 3. creative/asset/search (creative library)
  console.log('\n=== creative asset search ===');
  try {
    const r3 = await fetch(`${BASE}/v1.3/creative/asset/search/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
      body: JSON.stringify({
        advertiser_id: ADV_ID,
        asset_type: 'VIDEO',
        filtering: { asset_ids: [VIDEO_ID] },
      }),
    });
    const d3 = await r3.json();
    console.log(JSON.stringify(d3, null, 2).substring(0, 500));
  } catch (e: any) { console.log(e.message); }

  // 4. Try the ad/get directly to see if deleted ad has video info
  console.log('\n=== ad/get for deleted ad 1855388992993393 ===');
  try {
    const r4 = await fetch(`${BASE}/v1.3/ad/get/?advertiser_id=${ADV_ID}&filtering=${JSON.stringify({ad_ids:['1855388992993393']})}&fields=${JSON.stringify(['ad_id','ad_name','video_id','status'])}`, {
      headers: { 'Access-Token': ACCESS_TOKEN },
    });
    const d4 = await r4.json();
    console.log(JSON.stringify(d4, null, 2).substring(0, 500));
  } catch (e: any) { console.log(e.message); }
}
main();
