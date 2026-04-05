import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function investigateSmartPlusMetrics() {
  try {
    console.log('=== Smart+ Ad Metrics Investigation ===\n');

    // 全Advertiserを確認
    const allAdvertisers = await prisma.advertiser.findMany();
    console.log('Available advertisers:');
    allAdvertisers.forEach(adv => {
      console.log(`  - ${adv.name} (ID: ${adv.tiktokAdvertiserId})`);
    });
    console.log();

    // AI1のAdvertiserを取得（部分一致）
    const advertiser = await prisma.advertiser.findFirst({
      where: {
        name: { contains: 'AI_1' },
      },
    });

    if (!advertiser) {
      console.log('AI1 advertiser not found. Using first advertiser instead.');
      const firstAdv = allAdvertisers[0];
      if (!firstAdv) {
        console.log('No advertisers found in database');
        return;
      }
      console.log(`Using advertiser: ${firstAdv.name}\n`);
      const advertiser = firstAdv;
    } else {
      console.log(`Found advertiser: ${advertiser.name} (${advertiser.tiktokAdvertiserId})\n`);
    }

    const targetAdvertiser = advertiser || allAdvertisers[0];

    // OAuthTokenを取得
    const token = await prisma.oAuthToken.findUnique({
      where: {
        advertiserId: targetAdvertiser.tiktokAdvertiserId,
      },
    });

    if (!token) {
      console.log('OAuth token not found');
      return;
    }

    // Smart+広告をTikTok APIから取得
    console.log('Fetching Smart+ ads from TikTok API...');
    const smartPlusResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
      headers: {
        'Access-Token': token.accessToken,
      },
      params: {
        advertiser_id: targetAdvertiser.tiktokAdvertiserId,
        page_size: 10,
      },
    });

    const smartPlusAds = smartPlusResponse.data.data?.list || [];
    console.log(`Found ${smartPlusAds.length} Smart+ ads from API\n`);

    if (smartPlusAds.length > 0) {
      const firstAd = smartPlusAds[0];
      console.log('First Smart+ ad from API:');
      console.log(`  ad_id: ${firstAd.ad_id}`);
      console.log(`  smart_plus_ad_id: ${firstAd.smart_plus_ad_id}`);
      console.log(`  ad_name: ${firstAd.ad_name}`);
      console.log(`  adgroup_id: ${firstAd.adgroup_id}`);
      console.log(`  campaign_id: ${firstAd.campaign_id}`);
      console.log(`  operation_status: ${firstAd.operation_status}\n`);

      // DBに保存されている広告を確認
      const dbAd1 = await prisma.ad.findUnique({
        where: { tiktokId: String(firstAd.ad_id) },
      });

      const dbAd2 = await prisma.ad.findUnique({
        where: { tiktokId: String(firstAd.smart_plus_ad_id) },
      });

      console.log('Checking DB for this ad:');
      console.log(`  Found with ad_id (${firstAd.ad_id}): ${dbAd1 ? 'YES (id=' + dbAd1.id + ')' : 'NO'}`);
      console.log(`  Found with smart_plus_ad_id (${firstAd.smart_plus_ad_id}): ${dbAd2 ? 'YES (id=' + dbAd2.id + ')' : 'NO'}\n`);

      // メトリクスAPIからデータを取得
      console.log('Fetching metrics from TikTok API...');
      const today = new Date();
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() - 1);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 7);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      console.log(`Date range: ${startDateStr} to ${endDateStr}\n`);

      const metricsResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/', {
        headers: {
          'Access-Token': token.accessToken,
        },
        params: {
          advertiser_id: targetAdvertiser.tiktokAdvertiserId,
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
      console.log(`Retrieved ${metrics.length} metric records from API\n`);

      // すべてのad_idを表示
      const allAdIds = [...new Set(metrics.map((m: any) => m.dimensions?.ad_id))];
      console.log('All ad_ids in metrics response:');
      console.log(allAdIds.slice(0, 10).join(', '));
      console.log();

      // Smart+ ad IDが含まれているかチェック
      const smartPlusAdIdsInMetrics = allAdIds.filter(id =>
        smartPlusAds.some((ad: any) => String(ad.smart_plus_ad_id) === String(id))
      );
      console.log(`Smart+ ad IDs found in metrics: ${smartPlusAdIdsInMetrics.length}`);
      if (smartPlusAdIdsInMetrics.length > 0) {
        console.log('Sample:', smartPlusAdIdsInMetrics.slice(0, 3).join(', '));
      }
      console.log();

      // firstAdのメトリクスを探す
      const adMetrics1 = metrics.filter((m: any) => m.dimensions?.ad_id === firstAd.ad_id);
      const adMetrics2 = metrics.filter((m: any) => String(m.dimensions?.ad_id) === String(firstAd.smart_plus_ad_id));

      console.log(`Metrics for ad_id (${firstAd.ad_id}): ${adMetrics1.length} records`);
      if (adMetrics1.length > 0) {
        console.log('  Sample:', JSON.stringify(adMetrics1[0], null, 2));
      }

      console.log(`\nMetrics for smart_plus_ad_id (${firstAd.smart_plus_ad_id}): ${adMetrics2.length} records`);
      if (adMetrics2.length > 0) {
        console.log('  Sample:', JSON.stringify(adMetrics2[0], null, 2));
      }

      // DBに保存されているメトリクスを確認
      if (dbAd1) {
        const savedMetrics1 = await prisma.metric.findMany({
          where: {
            adId: dbAd1.id,
            statDate: {
              gte: startDate,
              lte: endDate,
            },
          },
        });
        console.log(`\nSaved metrics in DB for ad_id: ${savedMetrics1.length} records`);
        if (savedMetrics1.length > 0) {
          console.log('  Sample:', {
            impressions: savedMetrics1[0].impressions,
            clicks: savedMetrics1[0].clicks,
            spend: savedMetrics1[0].spend,
          });
        }
      }

      if (dbAd2) {
        const savedMetrics2 = await prisma.metric.findMany({
          where: {
            adId: dbAd2.id,
            statDate: {
              gte: startDate,
              lte: endDate,
            },
          },
        });
        console.log(`\nSaved metrics in DB for smart_plus_ad_id: ${savedMetrics2.length} records`);
        if (savedMetrics2.length > 0) {
          console.log('  Sample:', {
            impressions: savedMetrics2[0].impressions,
            clicks: savedMetrics2[0].clicks,
            spend: savedMetrics2[0].spend,
          });
        }
      }
    }

    // すべてのSmart+広告のメトリクスをチェック
    console.log('\n=== Checking all Smart+ ads in DB ===\n');

    // Smart+広告IDのセットを作成
    const smartPlusAdIds = new Set(
      smartPlusAds.map((apiAd: any) => String(apiAd.smart_plus_ad_id))
    );

    // Smart+広告をDBから取得
    const allSmartPlusInDB = await prisma.ad.findMany({
      where: {
        tiktokId: {
          in: Array.from(smartPlusAdIds) as string[],
        },
      },
      include: {
        adGroup: {
          include: {
            campaign: {
              include: {
                advertiser: true,
              },
            },
          },
        },
      },
    });

    console.log(`Found ${allSmartPlusInDB.length} Smart+ ads in DB`);

    for (const dbAd of allSmartPlusInDB.slice(0, 5)) {
      const metrics = await prisma.metric.findMany({
        where: {
          adId: dbAd.id,
        },
        orderBy: {
          statDate: 'desc',
        },
        take: 7,
      });

      const totalSpend = metrics.reduce((sum, m) => sum + m.spend, 0);
      const totalImpressions = metrics.reduce((sum, m) => sum + m.impressions, 0);

      console.log(`\nAd: ${dbAd.name} (tiktokId: ${dbAd.tiktokId})`);
      console.log(`  Metrics count: ${metrics.length}`);
      console.log(`  Total spend: ${totalSpend}`);
      console.log(`  Total impressions: ${totalImpressions}`);
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

investigateSmartPlusMetrics();
