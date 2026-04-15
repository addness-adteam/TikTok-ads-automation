import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SNS2_ADVERTISER_ID = '7543540100849156112';
const TARGET_AD_ID = '1860111049498673';

async function main() {
  // 1. 通常Ad API: statusフィールドを除外してリトライ
  console.log('=== 1. 通常 Ad API: 正しいfieldsで検索 ===');
  const ad1 = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      filtering: JSON.stringify({ ad_ids: [TARGET_AD_ID] }),
      fields: JSON.stringify(['ad_id', 'ad_name', 'adgroup_id', 'campaign_id', 'operation_status', 'secondary_status', 'create_time', 'modify_time', 'smart_plus_ad_id']),
    },
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  console.log(`code: ${ad1.data?.code}, msg: ${ad1.data?.message}`);
  const ads1 = ad1.data?.data?.list || [];
  console.log(`結果: ${ads1.length}件`);
  if (ads1.length > 0) console.log(JSON.stringify(ads1[0], null, 2));

  // 2. adgroup レベルでレポート取得して、どのadgroupに属するか確認
  console.log('\n=== 2. レポートAPI: adgroup_id + ad_id ===');
  const report = await axios.get('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      report_type: 'BASIC',
      dimensions: JSON.stringify(['ad_id', 'campaign_id']),
      metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
      data_level: 'AUCTION_AD',
      start_date: '2026-03-20',
      end_date: '2026-03-24',
      filtering: JSON.stringify([
        { field_name: 'ad_ids', filter_type: 'IN', filter_value: JSON.stringify([TARGET_AD_ID]) },
      ]),
    },
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  console.log(`code: ${report.data?.code}`);
  const rows = report.data?.data?.list || [];
  console.log(`結果: ${rows.length}件`);
  for (const r of rows) {
    console.log(JSON.stringify(r, null, 2));
  }

  // 3. SNS2の全Smart+広告のIDを番号比較で近いものを探す
  console.log('\n=== 3. SNS2 Smart+広告: ID近似検索 ===');
  const spResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      filtering: JSON.stringify({ operation_status: 'ENABLE' }),
      page_size: 100,
    },
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const spAds = spResp.data?.data?.list || [];
  const targetNum = BigInt(TARGET_AD_ID);
  const sorted = spAds
    .map((a: any) => ({
      id: a.smart_plus_ad_id,
      name: a.ad_name,
      diff: Math.abs(Number(BigInt(a.smart_plus_ad_id) - targetNum)),
    }))
    .sort((a: any, b: any) => a.diff - b.diff)
    .slice(0, 5);
  console.log('IDが近い広告 TOP5:');
  for (const s of sorted) {
    console.log(`  ${s.id} (diff: ${s.diff}) ${s.name}`);
  }

  // 4. campaign_idからSmart+キャンペーン情報を取得
  if (rows.length > 0 && rows[0].dimensions?.campaign_id) {
    const campaignId = rows[0].dimensions.campaign_id;
    console.log(`\n=== 4. キャンペーン ${campaignId} の詳細 ===`);

    // Smart+キャンペーンとして取得
    const campResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/campaign/get/', {
      params: {
        advertiser_id: SNS2_ADVERTISER_ID,
        filtering: JSON.stringify({ campaign_ids: [campaignId] }),
        fields: JSON.stringify(['campaign_id', 'campaign_name', 'campaign_type', 'objective_type', 'budget', 'operation_status']),
      },
      headers: { 'Access-Token': ACCESS_TOKEN },
    });
    const campaigns = campResp.data?.data?.list || [];
    console.log(`通常Campaign API: ${campaigns.length}件`);
    if (campaigns.length > 0) console.log(JSON.stringify(campaigns[0], null, 2));

    // このキャンペーンに属するSmart+広告を検索
    const matchedSp = spAds.filter((a: any) => a.campaign_id === campaignId);
    console.log(`\nSmart+広告で同じcampaign_id: ${matchedSp.length}件`);
    for (const a of matchedSp) {
      console.log(`  ${a.ad_name} (id: ${a.smart_plus_ad_id})`);
    }
  }

  // 5. SNS2の最近の全レポートから、Smart+ API外の広告を検出
  console.log('\n=== 5. レポートAPIの全ad_id vs Smart+ API ===');
  const spAdIds = new Set(spAds.map((a: any) => a.smart_plus_ad_id));
  const allReport = await axios.get('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/', {
    params: {
      advertiser_id: SNS2_ADVERTISER_ID,
      report_type: 'BASIC',
      dimensions: JSON.stringify(['ad_id']),
      metrics: JSON.stringify(['spend', 'impressions']),
      data_level: 'AUCTION_AD',
      start_date: '2026-03-24',
      end_date: '2026-03-24',
      page_size: 100,
    },
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const allReportAds = allReport.data?.data?.list || [];
  console.log(`本日レポートに存在するad_id: ${allReportAds.length}件`);
  const missingFromApi = allReportAds.filter((r: any) => !spAdIds.has(r.dimensions?.ad_id));
  console.log(`Smart+ APIに存在しないad_id: ${missingFromApi.length}件`);
  for (const r of missingFromApi) {
    console.log(`  ad_id: ${r.dimensions?.ad_id}, spend: ¥${r.metrics?.spend}, imp: ${r.metrics?.impressions}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
