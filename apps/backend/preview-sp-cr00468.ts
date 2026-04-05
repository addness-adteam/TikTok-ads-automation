import axios from 'axios';
const TIKTOK_API = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1_ID = '7474920444831875080';
const AD_ID = '1858931396655186';

async function main() {
  // Smart+ API で詳細取得
  const resp = await axios.get(`${TIKTOK_API}/v1.3/smart_plus/ad/get/`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: SP1_ID,
      filtering: JSON.stringify({ ad_ids: [AD_ID] }),
    },
  });
  const ad = resp.data?.data?.list?.[0];
  if (!ad) { console.log('Smart+ APIで見つからず'); return; }

  console.log('=== CR00468 Smart+ 広告詳細 ===');
  console.log(`ad_id: ${ad.ad_id}`);
  console.log(`ad_name: ${ad.ad_name}`);
  console.log(`status: ${ad.operation_status}`);

  const creativeList = ad.creative_list || [];
  console.log(`\n動画数: ${creativeList.length}本`);
  for (let i = 0; i < creativeList.length; i++) {
    const c = creativeList[i];
    const videoId = c?.creative_info?.video_info?.video_id;
    console.log(`  [${i}] video_id: ${videoId}`);
  }

  const adTexts = (ad.ad_text_list || []).map((t: any) => t.ad_text);
  console.log(`\n広告文: ${adTexts.length}件`);
  for (const t of adTexts) console.log(`  "${t?.substring(0, 60)}"`);

  const lpUrls = (ad.landing_page_url_list || []).map((l: any) => l.landing_page_url);
  console.log(`\nLP URL: ${lpUrls.length}件`);
  for (const u of lpUrls) console.log(`  ${u?.substring(0, 80)}`);
}
main().catch(console.error);
