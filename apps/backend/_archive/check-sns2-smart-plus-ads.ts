import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SNS2_ADVERTISER_ID = '7543540100849156112';

async function main() {
  // Smart+キャンペーン一覧を取得
  const campResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/campaign/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      fields: JSON.stringify(['campaign_id', 'campaign_name', 'campaign_type', 'objective_type', 'status', 'opt_status']),
      page_size: 100,
    },
    headers: {
      'Access-Token': ACCESS_TOKEN,
    },
  });

  const campaigns = campResponse.data?.data?.list || [];
  console.log(`=== SNS2 全キャンペーン: ${campaigns.length}件 ===`);
  for (const c of campaigns) {
    console.log(`  ${c.campaign_name} (id: ${c.campaign_id}, type: ${c.campaign_type}, status: ${c.status}, opt: ${c.opt_status})`);
  }

  // Smart+広告取得（ad/getをページネーション付きで）
  let page = 1;
  let totalAds: any[] = [];
  while (true) {
    const adResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
      params: {
        advertiser_id: SNS2_ADVERTISER_ID,
        page: page,
        page_size: 100,
        fields: JSON.stringify(['ad_id', 'ad_name', 'adgroup_id', 'campaign_id', 'status', 'opt_status', 'secondary_status']),
      },
      headers: {
        'Access-Token': ACCESS_TOKEN,
      },
    });
    const ads = adResponse.data?.data?.list || [];
    const total = adResponse.data?.data?.page_info?.total_number || 0;
    totalAds.push(...ads);
    console.log(`\nPage ${page}: ${ads.length}件 (total: ${total})`);
    if (ads.length === 0 || totalAds.length >= total) break;
    page++;
  }

  console.log(`\n=== SNS2 全広告（ページネーション後）: ${totalAds.length}件 ===`);
  for (const ad of totalAds) {
    console.log(`  ${ad.ad_name} (id: ${ad.ad_id}, status: ${ad.status}, secondary: ${ad.secondary_status})`);
  }

  // adgroup一覧も確認
  const adgroupResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/adgroup/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      fields: JSON.stringify(['adgroup_id', 'adgroup_name', 'campaign_id', 'status', 'opt_status', 'budget']),
      page_size: 100,
    },
    headers: {
      'Access-Token': ACCESS_TOKEN,
    },
  });

  const adgroups = adgroupResponse.data?.data?.list || [];
  console.log(`\n=== SNS2 全広告グループ: ${adgroups.length}件 ===`);
  for (const ag of adgroups) {
    console.log(`  ${ag.adgroup_name} (id: ${ag.adgroup_id}, campaign: ${ag.campaign_id}, status: ${ag.status}, budget: ${ag.budget})`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
