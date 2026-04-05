import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SNS2_ADVERTISER_ID = '7543540100849156112';

async function main() {
  // 1. Smart+ 全ページ取得
  console.log('=== Smart+ Ad API (全ページ) ===');
  let page = 1;
  let allSmartPlusAds: any[] = [];
  while (true) {
    const response = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
      params: {
        advertiser_id: SNS2_ADVERTISER_ID,
        page_size: 100,
        page: page,
      },
      headers: { 'Access-Token': ACCESS_TOKEN },
    });
    const ads = response.data?.data?.list || [];
    const total = response.data?.data?.page_info?.total_number || 0;
    allSmartPlusAds.push(...ads);
    console.log(`Page ${page}: ${ads.length}件 (total: ${total})`);
    if (ads.length === 0 || allSmartPlusAds.length >= total) break;
    page++;
  }

  // ENABLEの広告を表示
  const enableAds = allSmartPlusAds.filter((a: any) => a.operation_status === 'ENABLE');
  console.log(`\nENABLE: ${enableAds.length}件, DISABLE: ${allSmartPlusAds.length - enableAds.length}件`);
  for (const ad of enableAds) {
    console.log(`  ★ ${ad.ad_name} (id: ${ad.smart_plus_ad_id}, status: ${ad.operation_status})`);
  }

  // 「村上」「問題ないです」「29527」で部分一致検索
  const keywords = ['村上', '問題ないです', '29527', 'CR295'];
  for (const kw of keywords) {
    const matched = allSmartPlusAds.filter((a: any) => a.ad_name?.includes(kw));
    if (matched.length > 0) {
      console.log(`\n"${kw}" にマッチ: ${matched.length}件`);
      for (const ad of matched) {
        console.log(`  ${ad.ad_name} (id: ${ad.smart_plus_ad_id}, status: ${ad.operation_status})`);
      }
    } else {
      console.log(`\n"${kw}" にマッチ: 0件`);
    }
  }

  // 2. 通常広告API - 全ステータス・全ページ
  console.log('\n=== 通常 Ad API (全ステータス・全ページ) ===');
  let adPage = 1;
  let allRegularAds: any[] = [];
  while (true) {
    const response = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
      params: {
        advertiser_id: SNS2_ADVERTISER_ID,
        page_size: 1000,
        page: adPage,
        fields: JSON.stringify(['ad_id', 'ad_name', 'adgroup_id', 'campaign_id', 'status', 'opt_status', 'secondary_status', 'create_time', 'modify_time']),
      },
      headers: { 'Access-Token': ACCESS_TOKEN },
    });
    const ads = response.data?.data?.list || [];
    const total = response.data?.data?.page_info?.total_number || 0;
    allRegularAds.push(...ads);
    console.log(`Page ${adPage}: ${ads.length}件 (total: ${total})`);
    if (ads.length === 0 || allRegularAds.length >= total) break;
    adPage++;
  }

  if (allRegularAds.length > 0) {
    // 配信中の広告
    const active = allRegularAds.filter((a: any) =>
      a.status === 'AD_STATUS_DELIVERY_OK' || a.opt_status === 'ENABLE'
    );
    console.log(`\n配信中: ${active.length}件`);
    for (const ad of active) {
      console.log(`  ${ad.ad_name} (id: ${ad.ad_id}, status: ${ad.status})`);
    }

    // キーワード検索
    for (const kw of keywords) {
      const matched = allRegularAds.filter((a: any) => a.ad_name?.includes(kw));
      if (matched.length > 0) {
        console.log(`\n通常広告 "${kw}" マッチ: ${matched.length}件`);
        for (const ad of matched) {
          console.log(`  ${ad.ad_name} (id: ${ad.ad_id}, status: ${ad.status}, opt: ${ad.opt_status})`);
        }
      }
    }
  }

  // 3. 全キャンペーン取得（配信中含む）
  console.log('\n=== 全キャンペーン ===');
  const campResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/campaign/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      fields: JSON.stringify(['campaign_id', 'campaign_name', 'campaign_type', 'objective_type', 'status', 'opt_status', 'budget', 'create_time']),
      page_size: 100,
    },
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const campaigns = campResponse.data?.data?.list || [];
  console.log(`キャンペーン数: ${campaigns.length}`);
  const activeCampaigns = campaigns.filter((c: any) => c.opt_status === 'ENABLE' || c.status === 'CAMPAIGN_STATUS_ENABLE');
  console.log(`配信中キャンペーン: ${activeCampaigns.length}件`);
  for (const c of activeCampaigns) {
    console.log(`  ${c.campaign_name} (id: ${c.campaign_id}, budget: ${c.budget}, type: ${c.campaign_type})`);
  }

  // 3/24作成の広告を探す
  console.log('\n=== 最近作成されたSmart+広告 (3/20以降) ===');
  const recentAds = allSmartPlusAds
    .filter((a: any) => a.create_time >= '2026-03-20')
    .sort((a: any, b: any) => (b.create_time || '').localeCompare(a.create_time || ''));
  for (const ad of recentAds) {
    console.log(`  [${ad.create_time}] ${ad.ad_name} (status: ${ad.operation_status})`);
  }

  // create_timeがない場合、全広告名を出力
  if (recentAds.length === 0) {
    console.log('create_timeフィールドなし。260320〜で始まる広告:');
    const recent = allSmartPlusAds.filter((a: any) =>
      a.ad_name?.startsWith('2603')
    );
    for (const ad of recent) {
      console.log(`  ${ad.ad_name} (id: ${ad.smart_plus_ad_id}, status: ${ad.operation_status})`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
