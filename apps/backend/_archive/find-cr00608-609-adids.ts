import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';

async function getChildAd(campaignId: string, label: string) {
  const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: SP1,
      page_size: 10,
      filtering: JSON.stringify({ campaign_ids: [campaignId] }),
    },
  });
  const ads = resp.data.data?.list || [];
  console.log(`\n${label} (campaign: ${campaignId}):`);
  for (const ad of ads) {
    console.log(`  ad_id: ${ad.ad_id} | ${ad.ad_name}`);
  }
}

async function main() {
  await getChildAd('1862063400838209', 'CR00608 - セミまとめ(CVポイント検証)再出稿');
  await getChildAd('1862063467658418', 'CR00609 - おい会社員/穏やか_3万小遣い');
}

main().catch(console.error);
