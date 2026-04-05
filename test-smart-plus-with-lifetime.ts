import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function testSmartPlusWithLifetime() {
  try {
    console.log('=== Testing Smart+ Metrics with Lifetime Query ===\n');

    const advertiser = await prisma.advertiser.findFirst({
      where: { name: { contains: 'AI_1' } },
    });

    if (!advertiser) {
      console.log('AI_1 advertiser not found');
      return;
    }

    console.log(`Using advertiser: ${advertiser.name} (${advertiser.tiktokAdvertiserId})\n`);

    const token = await prisma.oAuthToken.findUnique({
      where: { advertiserId: advertiser.tiktokAdvertiserId },
    });

    if (!token) {
      console.log('OAuth token not found');
      return;
    }

    // Smart+広告を取得
    console.log('=== Step 1: Fetching Smart+ Ads ===');
    const smartPlusResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
      headers: { 'Access-Token': token.accessToken },
      params: {
        advertiser_id: advertiser.tiktokAdvertiserId,
        page_size: 10,
      },
    });

    const smartPlusAds = smartPlusResponse.data.data?.list || [];
    console.log(`Found ${smartPlusAds.length} Smart+ ads`);

    if (smartPlusAds.length > 0) {
      console.log(`Sample ad: ${smartPlusAds[0].ad_name} (${smartPlusAds[0].smart_plus_ad_id})`);
      console.log(`  Status: ${smartPlusAds[0].operation_status}\n`);
    }

    // ライフタイムメトリクスを取得
    console.log('=== Step 2: Fetching Lifetime Metrics ===');
    const metricsResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/material_report/overview/', {
      headers: { 'Access-Token': token.accessToken },
      params: {
        advertiser_id: advertiser.tiktokAdvertiserId,
        dimensions: JSON.stringify(['smart_plus_ad_id', 'main_material_id']),
        metrics: JSON.stringify(['impressions', 'clicks', 'spend', 'conversion', 'ctr', 'cpc', 'cpm', 'cost_per_conversion', 'video_watched_2s', 'video_watched_6s']),
        query_lifetime: true,
        page: 1,
        page_size: 100,
      },
    });

    const metricsData = metricsResponse.data.data?.list || [];
    console.log(`Received ${metricsData.length} metric records (creative-level)\n`);

    if (metricsData.length === 0) {
      console.log('No metrics data returned.');
      console.log('API Response:', JSON.stringify(metricsResponse.data, null, 2));
      return;
    }

    // サンプルレコードを表示
    console.log('Sample metric record:');
    console.log(JSON.stringify(metricsData[0], null, 2));
    console.log();

    // 集計プレビュー
    console.log('=== Step 3: Aggregation Preview ===');
    const adMetricsMap = new Map<string, any>();

    for (const record of metricsData) {
      const smartPlusAdId = record.dimensions?.smart_plus_ad_id;
      if (!smartPlusAdId) continue;

      if (!adMetricsMap.has(smartPlusAdId)) {
        adMetricsMap.set(smartPlusAdId, {
          creativeCount: 0,
          impressions: 0,
          clicks: 0,
          spend: 0,
          conversions: 0,
        });
      }

      const agg = adMetricsMap.get(smartPlusAdId)!;
      agg.creativeCount += 1;
      agg.impressions += parseInt(record.metrics?.impressions || '0', 10);
      agg.clicks += parseInt(record.metrics?.clicks || '0', 10);
      agg.spend += parseFloat(record.metrics?.spend || '0');
      agg.conversions += parseInt(record.metrics?.conversion || '0', 10);
    }

    console.log(`Aggregated ${metricsData.length} records into ${adMetricsMap.size} ads:\n`);

    for (const [adId, agg] of Array.from(adMetricsMap.entries()).slice(0, 5)) {
      const ad = await prisma.ad.findUnique({
        where: { tiktokId: String(adId) },
        select: { id: true, name: true },
      });

      console.log(`Smart+ Ad ID: ${adId}`);
      console.log(`  Name: ${ad?.name || 'NOT IN DB'}`);
      console.log(`  Creatives: ${agg.creativeCount}`);
      console.log(`  Total Impressions: ${agg.impressions}`);
      console.log(`  Total Clicks: ${agg.clicks}`);
      console.log(`  Total Spend: ¥${agg.spend.toFixed(2)}`);
      console.log(`  Total Conversions: ${agg.conversions}`);
      console.log();
    }

    // 実際にDBに保存
    console.log('=== Step 4: Saving to Database ===');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    let savedCount = 0;
    for (const [smartPlusAdId, aggregated] of adMetricsMap.entries()) {
      const ad = await prisma.ad.findUnique({
        where: { tiktokId: String(smartPlusAdId) },
      });

      if (!ad) {
        console.log(`⚠ Smart+ ad ${smartPlusAdId} not found in DB, skipping`);
        continue;
      }

      const ctr = aggregated.clicks > 0 ? (aggregated.clicks / aggregated.impressions) * 100 : 0;
      const cpc = aggregated.clicks > 0 ? aggregated.spend / aggregated.clicks : 0;
      const cpm = aggregated.impressions > 0 ? (aggregated.spend / aggregated.impressions) * 1000 : 0;
      const cpa = aggregated.conversions > 0 ? aggregated.spend / aggregated.conversions : 0;

      const deleteResult = await prisma.metric.deleteMany({
        where: {
          entityType: 'AD',
          adId: ad.id,
          statDate: yesterday,
        },
      });

      await prisma.metric.create({
        data: {
          entityType: 'AD',
          adId: ad.id,
          statDate: yesterday,
          impressions: aggregated.impressions,
          clicks: aggregated.clicks,
          spend: aggregated.spend,
          conversions: aggregated.conversions,
          ctr: ctr,
          cpc: cpc,
          cpm: cpm,
          cpa: cpa,
          videoViews: 0,
          videoWatched2s: 0,
          videoWatched6s: 0,
        },
      });

      console.log(`✓ Saved ${ad.name} (deleted ${deleteResult.count} old records)`);
      savedCount++;
    }

    console.log(`\n=== Summary ===`);
    console.log(`Successfully saved metrics for ${savedCount} Smart+ ads`);
    console.log(`Stat Date: ${yesterday.toISOString().split('T')[0]}`);

  } catch (error: any) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('API Response:', JSON.stringify(error.response.data, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

testSmartPlusWithLifetime();
