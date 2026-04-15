import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const AI1 = '7468288053866561553';

async function main() {
  // 通常広告からCR01207を検索
  const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: { advertiser_id: AI1, page_size: 100 },
  });
  const ads = resp.data.data?.list || [];
  const matched = ads.filter((a: any) => a.ad_name?.includes('CR01207'));
  for (const ad of matched) {
    console.log(`[通常] ad_id: ${ad.ad_id} | ${ad.ad_name} | ${ad.operation_status}`);
  }

  // Smart+からも
  const spResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: { advertiser_id: AI1, page_size: 100 },
  });
  const spAds = spResp.data.data?.list || [];
  const spMatched = spAds.filter((a: any) => a.ad_name?.includes('CR01207'));
  for (const ad of spMatched) {
    console.log(`[SP] ad_id: ${ad.ad_id} | campaign_id: ${ad.campaign_id} | ${ad.ad_name} | ${ad.operation_status}`);
  }

  // Smart+のcampaign_idから通常広告APIで子広告を取得
  if (spMatched.length > 0) {
    const campId = spMatched[0].campaign_id;
    const childResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
      headers: { 'Access-Token': ACCESS_TOKEN },
      params: {
        advertiser_id: AI1,
        page_size: 100,
        filtering: JSON.stringify({ campaign_ids: [campId] }),
      },
    });
    const children = childResp.data.data?.list || [];
    console.log(`\nSmart+配下の通常広告 (campaign ${campId}):`);
    for (const ad of children) {
      console.log(`  ad_id: ${ad.ad_id} | ${ad.ad_name}`);
    }
  }
}

main().catch(console.error);
