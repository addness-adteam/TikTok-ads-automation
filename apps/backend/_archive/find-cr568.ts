const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  for (let page = 1; page <= 5; page++) {
    const data = await tiktokGet('/v1.3/smart_plus/ad/get/', {
      advertiser_id: SP1,
      page_size: '100',
      page: String(page),
    });
    const ads = data.data?.list || [];
    if (ads.length === 0) break;
    for (const ad of ads) {
      const name = ad.smart_plus_ad_name || ad.ad_name || '';
      if (name.includes('CR00568') || name.includes('ROAS300')) {
        const adId = ad.smart_plus_ad_id || ad.ad_id;
        const creativeList = ad.creative_list || [];
        console.log(`\n[FOUND] ${name}`);
        console.log(`ad_id: ${adId}`);
        console.log(`creative_list: ${creativeList.length}件`);

        const videoIds: string[] = [];
        for (const c of creativeList) {
          const vid = c?.creative_info?.video_info?.video_id;
          if (vid && vid !== 'N/A') videoIds.push(vid);
        }
        console.log(`動画数: ${videoIds.length}本`);

        if (videoIds.length > 0) {
          const videoInfo = await tiktokGet('/v1.3/file/video/ad/info/', {
            advertiser_id: SP1,
            video_ids: JSON.stringify(videoIds),
          });
          const videos = videoInfo.data?.list || [];
          console.log('\n--- 動画一覧 ---');
          for (let i = 0; i < videoIds.length; i++) {
            const v = videos.find((x: any) => x.video_id === videoIds[i]);
            const name = v?.file_name || v?.display_name || 'N/A';
            const size = v?.video_size ? (v.video_size / 1024 / 1024).toFixed(1) + 'MB' : '?';
            console.log(`  [${i + 1}] ${videoIds[i]} | ${name} | ${size}`);
          }
        }
        return;
      }
    }
  }
  console.log('CR00568 not found');
}

main().catch(console.error);
