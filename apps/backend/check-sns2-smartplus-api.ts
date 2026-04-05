import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SNS2_ADVERTISER_ID = '7543540100849156112';

async function main() {
  // Smart+ Ad APIで取得
  const response = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      page_size: 100,
    },
    headers: {
      'Access-Token': ACCESS_TOKEN,
    },
  });

  console.log(`API code: ${response.data?.code}, message: ${response.data?.message}`);
  const ads = response.data?.data?.list || [];
  console.log(`=== SNS2 Smart+ 広告: ${ads.length}件 ===\n`);

  for (const ad of ads) {
    const isTarget = ad.ad_name?.includes('村上幸太朗') || ad.ad_name?.includes('CR29527');
    const marker = isTarget ? '★★★ TARGET ★★★ ' : '';
    console.log(`${marker}${ad.ad_name}`);
    console.log(`  smart_plus_ad_id: ${ad.smart_plus_ad_id}, ad_id: ${ad.ad_id}`);
    console.log(`  operation_status: ${ad.operation_status}`);
    console.log(`  campaign_id: ${ad.campaign_id}, adgroup_id: ${ad.adgroup_id}`);
    console.log(`  budget_optimize_on: ${ad.budget_optimize_on}`);
    console.log('');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
