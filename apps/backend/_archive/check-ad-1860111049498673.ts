import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SNS2_ADVERTISER_ID = '7543540100849156112';
const TARGET_AD_ID = '1860111049498673';

async function main() {
  // 1. Smart+ Ad APIで特定ID検索（smart_plus_ad_idsフィルタ）
  console.log('=== 1. Smart+ Ad API: smart_plus_ad_ids filter ===');
  const sp1 = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      filtering: JSON.stringify({ smart_plus_ad_ids: [TARGET_AD_ID] }),
    },
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  console.log(`code: ${sp1.data?.code}, msg: ${sp1.data?.message}, count: ${sp1.data?.data?.list?.length || 0}`);
  if (sp1.data?.data?.list?.length > 0) console.log(JSON.stringify(sp1.data.data.list[0], null, 2));

  // 2. 通常 Ad API: ad_idsフィルタ
  console.log('\n=== 2. 通常 Ad API: ad_ids filter ===');
  const ad1 = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      filtering: JSON.stringify({ ad_ids: [TARGET_AD_ID] }),
      fields: JSON.stringify(['ad_id', 'ad_name', 'adgroup_id', 'campaign_id', 'status', 'opt_status', 'secondary_status', 'create_time', 'modify_time']),
    },
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  console.log(`code: ${ad1.data?.code}, msg: ${ad1.data?.message}, count: ${ad1.data?.data?.list?.length || 0}`);
  if (ad1.data?.data?.list?.length > 0) console.log(JSON.stringify(ad1.data.data.list[0], null, 2));

  // 3. Smart+ Ad API: ENABLEフィルタ + 全ページ（IDが2ページ目にある可能性）
  console.log('\n=== 3. Smart+ Ad API: ENABLE filter, all pages ===');
  let page = 1;
  let allAds: any[] = [];
  while (true) {
    const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
      params: {
        advertiser_id: SNS2_ADVERTISER_ID,
        filtering: JSON.stringify({ operation_status: 'ENABLE' }),
        page_size: 100,
        page,
      },
      headers: { 'Access-Token': ACCESS_TOKEN },
    });
    const ads = resp.data?.data?.list || [];
    const total = resp.data?.data?.page_info?.total_number || 0;
    allAds.push(...ads);
    console.log(`Page ${page}: ${ads.length}件 (total: ${total})`);
    if (ads.length === 0 || allAds.length >= total) break;
    page++;
  }
  const found = allAds.find((a: any) => a.smart_plus_ad_id === TARGET_AD_ID);
  console.log(`ID ${TARGET_AD_ID} found in ENABLE list: ${!!found}`);
  if (found) console.log(JSON.stringify(found, null, 2));

  // 4. 全アカウントでこのIDを検索
  console.log('\n=== 4. 全アカウントでSmart+ Ad ID検索 ===');
  const ACCOUNTS = [
    { name: 'AI_1', id: '7468288053866561553' },
    { name: 'AI_2', id: '7523128243466551303' },
    { name: 'AI_3', id: '7543540647266074641' },
    { name: 'AI_4', id: '7580666710525493255' },
    { name: 'SP1', id: '7474920444831875080' },
    { name: 'SP2', id: '7592868952431362066' },
    { name: 'SP3', id: '7616545514662051858' },
    { name: 'SNS1', id: '7247073333517238273' },
    { name: 'SNS2', id: '7543540100849156112' },
    { name: 'SNS3', id: '7543540381615800337' },
  ];
  for (const acc of ACCOUNTS) {
    try {
      const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
        params: {
          advertiser_id: acc.id,
          filtering: JSON.stringify({ smart_plus_ad_ids: [TARGET_AD_ID] }),
        },
        headers: { 'Access-Token': ACCESS_TOKEN },
      });
      const count = resp.data?.data?.list?.length || 0;
      if (count > 0) {
        console.log(`★★★ ${acc.name} (${acc.id}): FOUND!`);
        console.log(JSON.stringify(resp.data.data.list[0], null, 2));
      } else {
        console.log(`${acc.name}: not found`);
      }
    } catch (e: any) {
      console.log(`${acc.name}: error - ${e.message}`);
    }
  }

  // 5. 通常ad/getでも全アカウント検索
  console.log('\n=== 5. 全アカウントで通常 Ad ID検索 ===');
  for (const acc of ACCOUNTS) {
    try {
      const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
        params: {
          advertiser_id: acc.id,
          filtering: JSON.stringify({ ad_ids: [TARGET_AD_ID] }),
          fields: JSON.stringify(['ad_id', 'ad_name', 'campaign_id', 'status', 'opt_status']),
        },
        headers: { 'Access-Token': ACCESS_TOKEN },
      });
      const count = resp.data?.data?.list?.length || 0;
      if (count > 0) {
        console.log(`★★★ ${acc.name} (${acc.id}): FOUND!`);
        console.log(JSON.stringify(resp.data.data.list[0], null, 2));
      } else {
        console.log(`${acc.name}: not found`);
      }
    } catch (e: any) {
      console.log(`${acc.name}: error - ${e.message}`);
    }
  }

  // 6. SNS2のSmart+広告を広告名に「村上」or「260320」含むものを広く検索
  console.log('\n=== 6. SNS2 Smart+広告: 260320 or 村上 含む広告 ===');
  const all260320 = allAds.filter((a: any) =>
    a.ad_name?.includes('260320') || a.ad_name?.includes('村上')
  );
  console.log(`マッチ: ${all260320.length}件`);
  for (const ad of all260320) {
    console.log(`  ${ad.ad_name} (id: ${ad.smart_plus_ad_id})`);
  }

  // 7. レポートAPIでメトリクスを確認（広告が存在すればメトリクスがある）
  console.log('\n=== 7. レポートAPI: ad_id指定 ===');
  try {
    const reportResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/', {
      params: {
        advertiser_id: SNS2_ADVERTISER_ID,
        report_type: 'BASIC',
        dimensions: JSON.stringify(['ad_id']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
        data_level: 'AUCTION_AD',
        start_date: '2026-03-24',
        end_date: '2026-03-24',
        filtering: JSON.stringify([
          { field_name: 'ad_ids', filter_type: 'IN', filter_value: JSON.stringify([TARGET_AD_ID]) },
        ]),
      },
      headers: { 'Access-Token': ACCESS_TOKEN },
    });
    console.log(`code: ${reportResp.data?.code}, msg: ${reportResp.data?.message}`);
    const rows = reportResp.data?.data?.list || [];
    console.log(`レポート結果: ${rows.length}件`);
    for (const r of rows) {
      console.log(JSON.stringify(r, null, 2));
    }
  } catch (e: any) {
    console.log(`Error: ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
