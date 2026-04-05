import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SNS2_ADVERTISER_ID = '7543540100849156112';

async function main() {
  // SNS2の全配信中広告を取得
  const response = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      filtering: JSON.stringify({
        status: 'AD_STATUS_DELIVERY_OK',
      }),
      fields: JSON.stringify(['ad_id', 'ad_name', 'adgroup_id', 'campaign_id', 'status', 'opt_status']),
      page_size: 100,
    },
    headers: {
      'Access-Token': ACCESS_TOKEN,
    },
  });

  const ads = response.data?.data?.list || [];
  console.log(`=== SNS2 配信中広告: ${ads.length}件 ===`);
  for (const ad of ads) {
    console.log(`  ${ad.ad_name} (ad_id: ${ad.ad_id})`);
  }

  // 「村上幸太朗」で全ステータス検索
  const response2 = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      filtering: JSON.stringify({}),
      fields: JSON.stringify(['ad_id', 'ad_name', 'adgroup_id', 'campaign_id', 'status', 'opt_status']),
      page_size: 100,
    },
    headers: {
      'Access-Token': ACCESS_TOKEN,
    },
  });

  const allAds = response2.data?.data?.list || [];
  console.log(`\n=== SNS2 全広告: ${allAds.length}件 ===`);
  const targetAds = allAds.filter((a: any) => a.ad_name?.includes('村上幸太朗') || a.ad_name?.includes('CR29527'));
  console.log(`\n=== 村上幸太朗/CR29527 関連: ${targetAds.length}件 ===`);
  for (const ad of targetAds) {
    console.log(`  ${ad.ad_name} (ad_id: ${ad.ad_id}, status: ${ad.status}, opt_status: ${ad.opt_status})`);
  }

  // Smart+キャンペーンか確認
  if (targetAds.length > 0) {
    const campaignIds = [...new Set(targetAds.map((a: any) => a.campaign_id))];
    const campResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/campaign/get/', {
      params: {
        advertiser_id: SNS2_ADVERTISER_ID,
        filtering: JSON.stringify({
          campaign_ids: campaignIds,
        }),
        fields: JSON.stringify(['campaign_id', 'campaign_name', 'campaign_type', 'objective_type', 'smart_plus']),
      },
      headers: {
        'Access-Token': ACCESS_TOKEN,
      },
    });
    const campaigns = campResponse.data?.data?.list || [];
    console.log(`\n=== 関連キャンペーン ===`);
    for (const c of campaigns) {
      console.log(`  ${c.campaign_name} (id: ${c.campaign_id}, type: ${c.campaign_type}, smart_plus: ${JSON.stringify(c.smart_plus)})`);
    }
  }

  // 全配信中広告のキャンペーン情報も確認
  if (ads.length > 0) {
    const campaignIds = [...new Set(ads.map((a: any) => a.campaign_id))];
    const campResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/campaign/get/', {
      params: {
        advertiser_id: SNS2_ADVERTISER_ID,
        filtering: JSON.stringify({
          campaign_ids: campaignIds,
        }),
        fields: JSON.stringify(['campaign_id', 'campaign_name', 'campaign_type', 'objective_type', 'smart_plus']),
      },
      headers: {
        'Access-Token': ACCESS_TOKEN,
      },
    });
    const campaigns = campResponse.data?.data?.list || [];
    console.log(`\n=== 配信中広告のキャンペーン ===`);
    for (const c of campaigns) {
      console.log(`  ${c.campaign_name} (id: ${c.campaign_id}, smart_plus: ${JSON.stringify(c.smart_plus)})`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
