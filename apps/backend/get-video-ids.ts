const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  // CR00580 via Smart+ API
  const spData = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: SP1,
    filtering: JSON.stringify({ smart_plus_ad_ids: ['1861717894619185'] }),
  });
  const ad = spData.data?.list?.[0];
  if (ad) {
    const name = ad.smart_plus_ad_name || ad.ad_name || '';
    const creativeList = ad.creative_list || [];
    const videoIds: string[] = [];
    for (const c of creativeList) {
      const vid = c?.creative_info?.video_info?.video_id;
      if (vid && vid !== 'N/A') videoIds.push(vid);
    }
    console.log(`[Smart+] ${name} -> videos: ${JSON.stringify(videoIds)}`);
  } else {
    console.log('Smart+ not found, trying regular API...');
    const adData = await tiktokGet('/v1.3/ad/get/', {
      advertiser_id: SP1,
      filtering: JSON.stringify({ ad_ids: ['1861717894619185'] }),
      fields: JSON.stringify(['ad_id', 'ad_name', 'video_id', 'status']),
    });
    const regular = adData.data?.list?.[0];
    if (regular) {
      console.log(`[Regular] ${regular.ad_name} -> video_id: ${regular.video_id}, status: ${regular.status}`);
    } else {
      console.log('Not found in either API');
    }
  }
}

main().catch(console.error);
