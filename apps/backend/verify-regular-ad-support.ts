import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SNS2_ADVERTISER_ID = '7543540100849156112';

async function main() {
  // 修正後のロジックをシミュレート

  // 1. Smart+ 広告取得（ENABLEフィルタ）
  const spResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      filtering: JSON.stringify({ operation_status: 'ENABLE' }),
      page_size: 100,
    },
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const smartPlusAds = spResp.data?.data?.list || [];
  console.log(`Smart+ 広告: ${smartPlusAds.length}件`);

  // 2. 通常広告取得（ENABLEフィルタ）
  const regResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      filtering: JSON.stringify({ operation_status: 'ENABLE' }),
      page_size: 100,
    },
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const allRegularAds = regResp.data?.data?.list || [];
  console.log(`通常広告（raw）: ${allRegularAds.length}件`);

  // 3. 重複除外
  const smartPlusAdIds = new Set(smartPlusAds.map((a: any) => a.smart_plus_ad_id));
  const regularAds = allRegularAds.filter((a: any) => !smartPlusAdIds.has(a.ad_id));
  console.log(`通常広告（重複除外後）: ${regularAds.length}件`);

  // 4. 結果表示
  console.log('\n=== Smart+ 広告（予算調整対象） ===');
  for (const ad of smartPlusAds.slice(0, 5)) {
    console.log(`  [SP] ${ad.ad_name} (id: ${ad.smart_plus_ad_id})`);
  }
  if (smartPlusAds.length > 5) console.log(`  ... 他 ${smartPlusAds.length - 5}件`);

  console.log('\n=== 通常広告（新規追加で予算調整対象に） ===');
  for (const ad of regularAds) {
    console.log(`  [REG] ${ad.ad_name} (id: ${ad.ad_id}, adgroup: ${ad.adgroup_id})`);
  }

  // 5. ターゲット広告の確認
  const target = regularAds.find((a: any) => a.ad_id === '1860111049498673');
  if (target) {
    console.log('\n★★★ ターゲット広告が正しく取得されました！ ★★★');
    console.log(`  ${target.ad_name} (id: ${target.ad_id})`);
  } else {
    console.log('\n⚠ ターゲット広告が見つかりません');
    // allRegularAdsにあるか確認
    const inAll = allRegularAds.find((a: any) => a.ad_id === '1860111049498673');
    if (inAll) {
      console.log('  → allRegularAdsには存在（重複除外で消えた？）');
    }
  }

  console.log(`\n合計: ${smartPlusAds.length + regularAds.length}件が予算調整対象`);
}
main().catch(e => { console.error(e); process.exit(1); });
