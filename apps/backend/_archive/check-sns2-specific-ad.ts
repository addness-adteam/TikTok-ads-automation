import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SNS2_ADVERTISER_ID = '7543540100849156112';
const TARGET_AD_ID = '1860111049498673';

async function main() {
  // 1. Smart+ Ad APIで特定IDを検索
  console.log('=== Smart+ Ad API (特定ID) ===');
  try {
    const response = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
      params: {
        advertiser_id: SNS2_ADVERTISER_ID,
        filtering: JSON.stringify({
          smart_plus_ad_ids: [TARGET_AD_ID],
        }),
        page_size: 10,
      },
      headers: { 'Access-Token': ACCESS_TOKEN },
    });
    console.log(`code: ${response.data?.code}, message: ${response.data?.message}`);
    const ads = response.data?.data?.list || [];
    console.log(`結果: ${ads.length}件`);
    for (const ad of ads) {
      console.log(JSON.stringify(ad, null, 2));
    }
  } catch (e: any) {
    console.log(`Error: ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`);
  }

  // 2. 全Smart+広告のoperation_statusの内訳を確認
  console.log('\n=== 全Smart+広告 operation_status内訳 ===');
  const allResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      page_size: 100,
    },
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const allAds = allResponse.data?.data?.list || [];
  const statusCount: Record<string, number> = {};
  for (const ad of allAds) {
    const s = ad.operation_status || 'undefined';
    statusCount[s] = (statusCount[s] || 0) + 1;
  }
  console.log(statusCount);

  // 3. 全広告のIDリストを出力して、TARGET_AD_IDが含まれるか確認
  const allIds = allAds.map((a: any) => a.smart_plus_ad_id);
  console.log(`\n全広告ID数: ${allIds.length}`);
  console.log(`TARGET_AD_ID ${TARGET_AD_ID} が含まれるか: ${allIds.includes(TARGET_AD_ID)}`);

  // 4. filtering with ENABLE status
  console.log('\n=== Smart+ Ad API (filtering: ENABLE) ===');
  try {
    const response = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
      params: {
        advertiser_id: SNS2_ADVERTISER_ID,
        filtering: JSON.stringify({
          operation_status: 'ENABLE',
        }),
        page_size: 100,
      },
      headers: { 'Access-Token': ACCESS_TOKEN },
    });
    console.log(`code: ${response.data?.code}, message: ${response.data?.message}`);
    const ads = response.data?.data?.list || [];
    console.log(`ENABLE広告: ${ads.length}件`);
    for (const ad of ads) {
      console.log(`  ${ad.ad_name} (id: ${ad.smart_plus_ad_id})`);
    }
  } catch (e: any) {
    console.log(`Error: ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`);
  }

  // 5. 「楢木野萌」の広告の全フィールドを確認
  console.log('\n=== 楢木野萌 広告の全フィールド ===');
  const narakino = allAds.find((a: any) => a.ad_name?.includes('楢木野'));
  if (narakino) {
    console.log(JSON.stringify(narakino, null, 2));
  }

  // 6. 260320で始まる広告を全て表示
  console.log('\n=== 260320で始まる広告 ===');
  const ads0320 = allAds.filter((a: any) => a.ad_name?.startsWith('260320'));
  console.log(`${ads0320.length}件`);
  for (const ad of ads0320) {
    console.log(`  ${ad.ad_name} (id: ${ad.smart_plus_ad_id}, status: ${ad.operation_status})`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
