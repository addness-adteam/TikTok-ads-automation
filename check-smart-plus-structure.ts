import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function checkSmartPlusStructure() {
  try {
    console.log('=== Checking Smart+ Ad Structure ===\n');

    const advertiser = await prisma.advertiser.findFirst({
      where: { name: { contains: 'AI_1' } },
    });

    if (!advertiser) {
      console.log('Advertiser not found');
      return;
    }

    const token = await prisma.oAuthToken.findUnique({
      where: { advertiserId: advertiser.tiktokAdvertiserId },
    });

    if (!token) {
      console.log('Token not found');
      return;
    }

    // Smart+広告を取得
    const smartPlusResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
      headers: { 'Access-Token': token.accessToken },
      params: {
        advertiser_id: advertiser.tiktokAdvertiserId,
        page_size: 5,
        filtering: JSON.stringify({ operation_status: 'ENABLE' }),
      },
    });

    const smartPlusAds = smartPlusResponse.data.data?.list || [];
    console.log(`Found ${smartPlusAds.length} ACTIVE Smart+ ads\n`);

    if (smartPlusAds.length > 0) {
      const firstAd = smartPlusAds[0];
      console.log('First Smart+ Ad Full Structure:');
      console.log(JSON.stringify(firstAd, null, 2));
      console.log('\n=== Key Fields ===');
      console.log(`smart_plus_ad_id: ${firstAd.smart_plus_ad_id}`);
      console.log(`ad_id: ${firstAd.ad_id}`);
      console.log(`ad_name: ${firstAd.ad_name}`);
      console.log(`creative_list length: ${firstAd.creative_list?.length || 0}`);

      if (firstAd.creative_list && firstAd.creative_list.length > 0) {
        console.log('\n=== Creative List ===');
        firstAd.creative_list.forEach((creative: any, index: number) => {
          console.log(`\nCreative ${index + 1}:`);
          console.log(`  material_id: ${creative.material_id}`);
          console.log(`  ad_id: ${creative.ad_id}`);
          console.log(`  material_operation_status: ${creative.material_operation_status}`);
          if (creative.creative_info) {
            console.log(`  creative_info.video_info.video_id: ${creative.creative_info.video_info?.video_id}`);
          }
        });
      }

      // レポートAPIでこのad_idを検索
      console.log('\n=== Checking Metrics API ===');
      const today = new Date();
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() - 1);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 7);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      const metricsResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/', {
        headers: { 'Access-Token': token.accessToken },
        params: {
          advertiser_id: advertiser.tiktokAdvertiserId,
          data_level: 'AUCTION_AD',
          report_type: 'BASIC',
          dimensions: JSON.stringify(['stat_time_day', 'ad_id']),
          metrics: JSON.stringify(['impressions', 'clicks', 'spend']),
          start_date: startDateStr,
          end_date: endDateStr,
          page: 1,
          page_size: 1000,
        },
      });

      const metrics = metricsResponse.data.data?.list || [];

      // smart_plus_ad_idで検索
      const metricsForSmartPlusId = metrics.filter((m: any) =>
        String(m.dimensions?.ad_id) === String(firstAd.smart_plus_ad_id)
      );

      console.log(`\nMetrics for smart_plus_ad_id (${firstAd.smart_plus_ad_id}): ${metricsForSmartPlusId.length} records`);

      // creative_list内のad_idで検索
      if (firstAd.creative_list && firstAd.creative_list.length > 0) {
        firstAd.creative_list.forEach((creative: any, index: number) => {
          const creativeMetrics = metrics.filter((m: any) =>
            String(m.dimensions?.ad_id) === String(creative.ad_id)
          );
          console.log(`Metrics for creative ${index + 1} ad_id (${creative.ad_id}): ${creativeMetrics.length} records`);
          if (creativeMetrics.length > 0) {
            console.log('  Sample:', {
              date: creativeMetrics[0].dimensions?.stat_time_day,
              impressions: creativeMetrics[0].metrics?.impressions,
              spend: creativeMetrics[0].metrics?.spend,
            });
          }
        });
      }
    }

  } catch (error: any) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('API Response:', JSON.stringify(error.response.data, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

checkSmartPlusStructure();
