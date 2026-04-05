import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function debugSmartPlusAPI() {
  try {
    console.log('=== Debugging Smart+ Metrics API ===\n');

    // AI1のAdvertiserを取得
    const advertiser = await prisma.advertiser.findFirst({
      where: { name: { contains: 'AI_1' } },
    });

    if (!advertiser) {
      console.log('AI_1 advertiser not found');
      return;
    }

    console.log(`Advertiser: ${advertiser.name} (${advertiser.tiktokAdvertiserId})\n`);

    const token = await prisma.oAuthToken.findUnique({
      where: { advertiserId: advertiser.tiktokAdvertiserId },
    });

    if (!token) {
      console.log('OAuth token not found');
      return;
    }

    // まず、Smart+広告が存在するか確認
    console.log('=== Step 1: Check Smart+ Ads ===');
    const smartPlusAdsResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
      headers: { 'Access-Token': token.accessToken },
      params: {
        advertiser_id: advertiser.tiktokAdvertiserId,
        page_size: 10,
      },
    });

    const smartPlusAds = smartPlusAdsResponse.data.data?.list || [];
    console.log(`Smart+ ads found: ${smartPlusAds.length}`);

    if (smartPlusAds.length > 0) {
      const enabledAds = smartPlusAds.filter((ad: any) => ad.operation_status === 'ENABLE');
      console.log(`ENABLE status ads: ${enabledAds.length}`);

      if (enabledAds.length > 0) {
        console.log('\nSample ENABLE ad:');
        const sampleAd = enabledAds[0];
        console.log(`  smart_plus_ad_id: ${sampleAd.smart_plus_ad_id}`);
        console.log(`  ad_name: ${sampleAd.ad_name}`);
        console.log(`  operation_status: ${sampleAd.operation_status}`);
        console.log(`  create_time: ${sampleAd.create_time}`);
        console.log();
      }
    }

    // 期間設定
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - 1);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 7);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    console.log(`\n=== Step 2: Test Different API Parameters ===`);
    console.log(`Date range: ${startDateStr} to ${endDateStr}\n`);

    // テスト1: campaign_id + main_material_id
    console.log('Test 1: campaign_id + main_material_id');
    try {
      const test1 = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/material_report/overview/', {
        headers: { 'Access-Token': token.accessToken },
        params: {
          advertiser_id: advertiser.tiktokAdvertiserId,
          dimensions: JSON.stringify(['campaign_id', 'main_material_id']),
          metrics: JSON.stringify(['impressions', 'clicks', 'spend']),
          query_lifetime: true,
        },
      });
      console.log('  Status:', test1.data.code);
      console.log('  Message:', test1.data.message);
      console.log('  Data count:', test1.data.data?.list?.length || 0);
      if (test1.data.data?.list?.length > 0) {
        console.log('  Sample records:', JSON.stringify(test1.data.data.list.slice(0, 2), null, 2));
      }
    } catch (error: any) {
      console.log('  Error:', error.response?.data || error.message);
    }

    // テスト2: adgroup_id + smart_plus_ad_id
    console.log('\nTest 2: adgroup_id + smart_plus_ad_id');
    try {
      const test2 = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/material_report/overview/', {
        headers: { 'Access-Token': token.accessToken },
        params: {
          advertiser_id: advertiser.tiktokAdvertiserId,
          dimensions: JSON.stringify(['adgroup_id', 'smart_plus_ad_id']),
          metrics: JSON.stringify(['impressions', 'clicks', 'spend']),
          query_lifetime: true,
        },
      });
      console.log('  Status:', test2.data.code);
      console.log('  Message:', test2.data.message);
      console.log('  Data count:', test2.data.data?.list?.length || 0);
      if (test2.data.data?.list?.length > 0) {
        console.log('  Sample record:', JSON.stringify(test2.data.data.list[0], null, 2));
      }
    } catch (error: any) {
      console.log('  Error:', error.response?.data || error.message);
    }

    // テスト3: smart_plus_ad_id + main_material_id
    console.log('\nTest 3: smart_plus_ad_id + main_material_id');
    try {
      const test3 = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/material_report/overview/', {
        headers: { 'Access-Token': token.accessToken },
        params: {
          advertiser_id: advertiser.tiktokAdvertiserId,
          dimensions: JSON.stringify(['smart_plus_ad_id', 'main_material_id']),
          metrics: JSON.stringify(['impressions', 'clicks', 'spend']),
          query_lifetime: true,
        },
      });
      console.log('  Status:', test3.data.code);
      console.log('  Message:', test3.data.message);
      console.log('  Data count:', test3.data.data?.list?.length || 0);
      if (test3.data.data?.list?.length > 0) {
        console.log('  Sample record:', JSON.stringify(test3.data.data.list[0], null, 2));
      }
    } catch (error: any) {
      console.log('  Error:', error.response?.data || error.message);
    }

    // テスト5: 通常のレポートAPIでSmart+広告が返されるか確認
    console.log('\n=== Step 3: Check Regular Report API ===');
    try {
      const regularReport = await axios.get('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/', {
        headers: { 'Access-Token': token.accessToken },
        params: {
          advertiser_id: advertiser.tiktokAdvertiserId,
          data_level: 'AUCTION_AD',
          report_type: 'BASIC',
          dimensions: JSON.stringify(['ad_id']),
          metrics: JSON.stringify(['impressions', 'clicks', 'spend']),
          start_date: startDateStr,
          end_date: endDateStr,
          page: 1,
          page_size: 10,
        },
      });

      const regularMetrics = regularReport.data.data?.list || [];
      console.log(`Regular report metrics: ${regularMetrics.length} records`);

      if (regularMetrics.length > 0 && smartPlusAds.length > 0) {
        const smartPlusAdIds = new Set(smartPlusAds.map((ad: any) => String(ad.smart_plus_ad_id)));
        const matchingMetrics = regularMetrics.filter((m: any) =>
          smartPlusAdIds.has(String(m.dimensions?.ad_id))
        );
        console.log(`Metrics matching Smart+ ad IDs: ${matchingMetrics.length}`);
      }
    } catch (error: any) {
      console.log('  Error:', error.response?.data || error.message);
    }

  } catch (error: any) {
    console.error('Fatal error:', error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

debugSmartPlusAPI();
