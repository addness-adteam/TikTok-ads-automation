const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  // Page 2
  const data2 = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: SP1,
    page_size: '100',
    page: '2',
  });
  const ads2 = data2.data?.list || [];
  console.log(`Page 2: ${ads2.length} ads`);
  for (const ad of ads2) {
    const name = ad.smart_plus_ad_name || ad.ad_name || '';
    if (name.includes('CR00580') || name.includes('1時間後悔')) {
      const creativeList = ad.creative_list || [];
      const videoIds: string[] = [];
      for (const c of creativeList) {
        const vid = c?.creative_info?.video_info?.video_id;
        if (vid && vid !== 'N/A') videoIds.push(vid);
      }
      console.log(`[FOUND] ${name} -> ad_id: ${ad.smart_plus_ad_id || ad.ad_id}, videos: ${JSON.stringify(videoIds)}`);
    }
  }

  // Page 3
  const data3 = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: SP1,
    page_size: '100',
    page: '3',
  });
  const ads3 = data3.data?.list || [];
  console.log(`Page 3: ${ads3.length} ads`);
  for (const ad of ads3) {
    const name = ad.smart_plus_ad_name || ad.ad_name || '';
    if (name.includes('CR00580') || name.includes('1時間後悔')) {
      const creativeList = ad.creative_list || [];
      const videoIds: string[] = [];
      for (const c of creativeList) {
        const vid = c?.creative_info?.video_info?.video_id;
        if (vid && vid !== 'N/A') videoIds.push(vid);
      }
      console.log(`[FOUND] ${name} -> ad_id: ${ad.smart_plus_ad_id || ad.ad_id}, videos: ${JSON.stringify(videoIds)}`);
    }
  }

  // Also list page 2 ads with 260407 in name
  console.log('\n260407 ads on page 2:');
  for (const ad of ads2) {
    const name = ad.smart_plus_ad_name || ad.ad_name || '';
    if (name.includes('260407')) {
      console.log(`  ${name} -> ${ad.smart_plus_ad_id || ad.ad_id}`);
    }
  }
}

main().catch(console.error);
