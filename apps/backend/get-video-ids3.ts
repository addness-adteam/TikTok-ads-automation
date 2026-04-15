const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  const adId = '1861717894619185';

  // Try regular ad/get with all fields
  console.log('=== Regular ad/get ===');
  const adData = await tiktokGet('/v1.3/ad/get/', {
    advertiser_id: SP1,
    filtering: JSON.stringify({ ad_ids: [adId] }),
    fields: JSON.stringify(['ad_id', 'ad_name', 'video_id', 'status', 'ad_format', 'creative_type']),
  });
  console.log(JSON.stringify(adData, null, 2));

  // Try smart_plus with explicit filtering
  console.log('\n=== Smart+ ad/get with filter ===');
  const spData = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: SP1,
    filtering: JSON.stringify({ smart_plus_ad_ids: [adId] }),
  });
  console.log(JSON.stringify(spData, null, 2).substring(0, 2000));

  // Maybe the operation_status is DISABLE - search with status filter
  console.log('\n=== Smart+ with DISABLE filter ===');
  const spDisable = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: SP1,
    filtering: JSON.stringify({ operation_status: 'DISABLE' }),
    page_size: '50',
  });
  const disabledAds = spDisable.data?.list || [];
  console.log(`Disabled ads: ${disabledAds.length}`);
  for (const ad of disabledAds) {
    const name = ad.smart_plus_ad_name || ad.ad_name || '';
    if (name.includes('CR00580') || name.includes('1時間後悔') || (ad.smart_plus_ad_id || ad.ad_id) === adId) {
      const creativeList = ad.creative_list || [];
      const videoIds: string[] = [];
      for (const c of creativeList) {
        const vid = c?.creative_info?.video_info?.video_id;
        if (vid && vid !== 'N/A') videoIds.push(vid);
      }
      console.log(`[FOUND DISABLED] ${name} -> ad_id: ${ad.smart_plus_ad_id || ad.ad_id}, videos: ${JSON.stringify(videoIds)}`);
    }
  }

  // Try the ad_id directly through campaign report or something
  // Actually let's try get ad via adgroup
  console.log('\n=== Try to find via full text search ===');
  for (let page = 1; page <= 10; page++) {
    const data = await tiktokGet('/v1.3/smart_plus/ad/get/', {
      advertiser_id: SP1,
      page_size: '100',
      page: String(page),
    });
    const ads = data.data?.list || [];
    if (ads.length === 0) { console.log(`Page ${page}: empty, stopping`); break; }
    for (const ad of ads) {
      const id = String(ad.smart_plus_ad_id || ad.ad_id);
      if (id === adId) {
        console.log(`[FOUND on page ${page}] ${ad.smart_plus_ad_name || ad.ad_name}`);
        const creativeList = ad.creative_list || [];
        const videoIds: string[] = [];
        for (const c of creativeList) {
          const vid = c?.creative_info?.video_info?.video_id;
          if (vid && vid !== 'N/A') videoIds.push(vid);
        }
        console.log(`  videos: ${JSON.stringify(videoIds)}`);
        return;
      }
    }
    console.log(`Page ${page}: ${ads.length} ads, not found`);
  }
}

main().catch(console.error);
