/**
 * CR00614の日予算取得検証
 * V2のロジックを模擬：通常API → 取れなければ Smart+ API で補完
 */
import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';
const CR00614_ADGROUP = '1862150030125057';

async function main() {
  // まずCR00614の広告情報を取得
  console.log('=== CR00614 広告情報 ===');
  const adResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: SP1,
      filtering: JSON.stringify({ adgroup_ids: [CR00614_ADGROUP] }),
      fields: JSON.stringify(['ad_id', 'ad_name', 'adgroup_id', 'campaign_id', 'status', 'operation_status']),
    },
  });
  const ads = adResp.data.data?.list || [];
  for (const ad of ads) {
    console.log(`  ad_id: ${ad.ad_id} | ${ad.ad_name} | status: ${ad.status} | op: ${ad.operation_status}`);
  }
  const campaignId = ads[0]?.campaign_id;
  console.log(`  campaign_id: ${campaignId}`);

  // V2の実際のロジックを模擬
  console.log('\n=== V2 ロジック模擬 ===');

  // Step1: 通常adgroup/get（campaign_idsベースで取得 = V2の実際の挙動）
  console.log('\n[Step1] 通常 adgroup/get (campaign_idsフィルタ)');
  const agResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/adgroup/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: SP1,
      filtering: JSON.stringify({ campaign_ids: [campaignId] }),
    },
  });
  const regularAgs = agResp.data.data?.list || [];
  const adgroupBudgetMap = new Map<string, number>();
  for (const ag of regularAgs) {
    if (ag.adgroup_id && ag.budget) {
      adgroupBudgetMap.set(ag.adgroup_id, parseFloat(ag.budget));
    }
  }
  console.log(`  通常API取得: ${regularAgs.length}件`);
  for (const ag of regularAgs) {
    console.log(`  ${ag.adgroup_id} | budget: ${ag.budget} | ${ag.adgroup_name}`);
  }

  // CR00614のadgroupは取れた？
  const hasCR00614 = adgroupBudgetMap.has(CR00614_ADGROUP);
  console.log(`\n  CR00614 adgroup予算: ${hasCR00614 ? `¥${adgroupBudgetMap.get(CR00614_ADGROUP)}` : '❌ 取得できず'}`);

  // Step2: 取れなかった場合、Smart+ APIで補完
  if (!hasCR00614) {
    console.log('\n[Step2] Smart+ adgroup/get で補完');
    const spResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/adgroup/get/', {
      headers: { 'Access-Token': ACCESS_TOKEN },
      params: {
        advertiser_id: SP1,
        adgroup_ids: JSON.stringify([CR00614_ADGROUP]),
      },
    });
    const spAgs = spResp.data.data?.list || [];
    for (const ag of spAgs) {
      if (ag.adgroup_id === CR00614_ADGROUP) {
        adgroupBudgetMap.set(ag.adgroup_id, parseFloat(ag.budget));
        console.log(`  ✅ Smart+ APIで補完成功: ${ag.adgroup_id} | budget: ¥${ag.budget}`);
      }
    }
  }

  console.log(`\n=== 最終結果 ===`);
  console.log(`CR00614 日予算: ¥${adgroupBudgetMap.get(CR00614_ADGROUP) || '取得失敗'}`);
}

main().catch(console.error);
