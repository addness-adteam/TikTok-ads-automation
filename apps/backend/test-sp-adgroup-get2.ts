/**
 * AI系アカウント（通常広告+Smart+混在）でadgroup予算取得を検証
 * Smart+のadgroupが通常APIで取れない場合を確認
 */
import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

// AI_1で検証
const AI_1 = '7468288053866561553';

async function main() {
  // まずアクティブな広告を取得してadgroup_idを集める
  console.log('=== AI_1のアクティブ広告からadgroup_id取得 ===');
  const adResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: AI_1,
      filtering: JSON.stringify({ status: 'STATUS_DELIVERY_OK' }),
      fields: JSON.stringify(['ad_id', 'ad_name', 'adgroup_id', 'campaign_id']),
      page_size: 50,
    },
  });

  const ads = adResp.data.data?.list || [];
  console.log(`配信中広告: ${ads.length}件`);

  const adgroupIds = [...new Set(ads.map((a: any) => a.adgroup_id))];
  const campaignIds = [...new Set(ads.map((a: any) => a.campaign_id))];
  console.log(`adgroup_id: ${adgroupIds.length}件`);

  // 通常adgroup/get
  console.log('\n=== 通常 adgroup/get ===');
  const agResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/adgroup/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: AI_1,
      filtering: JSON.stringify({ campaign_ids: campaignIds }),
    },
  });
  const regularAgs = agResp.data.data?.list || [];
  const regularIds = new Set(regularAgs.map((ag: any) => ag.adgroup_id));
  console.log(`通常API取得: ${regularAgs.length}件`);
  for (const ag of regularAgs) {
    console.log(`  ${ag.adgroup_id} | budget: ${ag.budget} | ${ag.adgroup_name}`);
  }

  const missing = adgroupIds.filter((id: string) => !regularIds.has(id));
  console.log(`\n通常APIで取得できなかった: ${missing.length}件`);
  if (missing.length > 0) {
    console.log(`  missing: ${missing.join(', ')}`);

    // Smart+ APIで補完
    console.log('\n=== Smart+ adgroup/get で補完 ===');
    const spResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/adgroup/get/', {
      headers: { 'Access-Token': ACCESS_TOKEN },
      params: {
        advertiser_id: AI_1,
        adgroup_ids: JSON.stringify(missing),
      },
    });
    const spAgs = spResp.data.data?.list || [];
    console.log(`Smart+ API取得: ${spAgs.length}件`);
    for (const ag of spAgs) {
      const isMissing = missing.includes(ag.adgroup_id) ? '★補完' : '';
      console.log(`  ${ag.adgroup_id} | budget: ${ag.budget} | ${ag.adgroup_name || '(no name)'} ${isMissing}`);
    }
  } else {
    console.log('→ 補完不要');
  }
}

main().catch(console.error);
