const TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const API_BASE = 'https://business-api.tiktok.com/open_api';
const ADV = '7523128243466551303';
const AD = '1851649899628722';

async function main() {
  // Smart+ ad detail
  const qs = new URLSearchParams({
    advertiser_id: ADV,
    filtering: JSON.stringify({ smart_plus_ad_ids: [AD] }),
    fields: JSON.stringify(['smart_plus_ad_id','ad_name','creative_list']),
    page_size: '10',
  });
  const r = await fetch(`${API_BASE}/v1.3/smart_plus/ad/get/?${qs}`, { headers: { 'Access-Token': TOKEN } });
  const d: any = await r.json();
  console.log('code:', d.code, 'msg:', d.message);
  const ad = d.data?.list?.[0];
  if (!ad) { console.log('not found'); return; }
  console.log('ad_name:', ad.ad_name);
  console.log('creatives:', ad.creative_list?.length);
  for (const c of ad.creative_list || []) {
    console.log(JSON.stringify(c, null, 2));
  }
  // video info for each video_id
  const videoIds = (ad.creative_list || []).map((c: any) => c.video_id || c.video_info?.video_id).filter(Boolean);
  console.log('\n=== Video details ===');
  for (const vid of videoIds) {
    const vqs = new URLSearchParams({ advertiser_id: ADV, video_ids: JSON.stringify([vid]) });
    const vr = await fetch(`${API_BASE}/v1.3/file/video/ad/info/?${vqs}`, { headers: { 'Access-Token': TOKEN } });
    const vd: any = await vr.json();
    for (const v of vd.data?.list || []) {
      console.log(`video_id: ${v.video_id}`);
      console.log(`  file_name: ${v.file_name}`);
      console.log(`  material_name: ${v.material_name}`);
      console.log(`  displayable: ${v.displayable}`);
    }
  }
}
main();
