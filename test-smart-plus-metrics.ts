import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function testSmartPlusMetrics() {
  try {
    console.log('=== Testing Smart+ Metrics Retrieval ===\n');

    // AI1のAdvertiserを取得
    const advertiser = await prisma.advertiser.findFirst({
      where: { name: { contains: 'AI_1' } },
    });

    if (!advertiser) {
      console.log('AI_1 advertiser not found');
      return;
    }

    console.log(`Using advertiser: ${advertiser.name} (${advertiser.tiktokAdvertiserId})\n`);

    // OAuthTokenを取得
    const token = await prisma.oAuthToken.findUnique({
      where: { advertiserId: advertiser.tiktokAdvertiserId },
    });

    if (!token) {
      console.log('OAuth token not found');
      return;
    }

    // 期間設定（過去30日間）
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - 1);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 30);

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    console.log(`Date range: ${startDateStr} to ${endDateStr}\n`);

    // Smart+メトリクスを取得（実際のスケジューラーと同じパラメータを使用）
    console.log('Calling Smart+ metrics API...');
    const response = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/material_report/overview/', {
      headers: {
        'Access-Token': token.accessToken,
      },
      params: {
        advertiser_id: advertiser.tiktokAdvertiserId,
        dimensions: JSON.stringify(['smart_plus_ad_id', 'main_material_id']),
        metrics: JSON.stringify([
          'impressions',
          'clicks',
          'spend',
          'ctr',
          'cpc',
          'cpm',
          'conversion',
          'cost_per_conversion',
          'video_watched_2s',
          'video_watched_6s',
        ]),
        start_date: startDateStr,
        end_date: endDateStr,
        page: 1,
        page_size: 100,
      },
    });

    const metricsData = response.data.data?.list || [];
    console.log(`Retrieved ${metricsData.length} metric records\n`);

    if (metricsData.length > 0) {
      // サンプルデータを表示
      console.log('Sample metric record:');
      console.log(JSON.stringify(metricsData[0], null, 2));
      console.log();

      // Smart+ ad IDごとに集計
      const adMetricsMap = new Map<string, any>();

      for (const record of metricsData) {
        const adId = record.dimensions?.smart_plus_ad_id;
        if (!adId) continue;

        if (!adMetricsMap.has(adId)) {
          adMetricsMap.set(adId, {
            adId,
            impressions: 0,
            clicks: 0,
            spend: 0,
            conversions: 0,
            dates: [],
          });
        }

        const adMetrics = adMetricsMap.get(adId)!;
        adMetrics.impressions += parseInt(record.metrics?.impressions || '0', 10);
        adMetrics.clicks += parseInt(record.metrics?.clicks || '0', 10);
        adMetrics.spend += parseFloat(record.metrics?.spend || '0');
        adMetrics.conversions += parseInt(record.metrics?.conversion || '0', 10); // 単数形に修正
        adMetrics.dates.push(record.dimensions?.stat_time_day);
      }

      console.log(`\n=== Aggregated Metrics (${adMetricsMap.size} Smart+ ads) ===\n`);

      for (const [adId, metrics] of adMetricsMap.entries()) {
        // DBから広告情報を取得
        const ad = await prisma.ad.findUnique({
          where: { tiktokId: String(adId) },
        });

        console.log(`Smart+ Ad ID: ${adId}`);
        console.log(`  Ad Name: ${ad?.name || 'NOT FOUND IN DB'}`);
        console.log(`  Total Impressions: ${metrics.impressions}`);
        console.log(`  Total Clicks: ${metrics.clicks}`);
        console.log(`  Total Spend: ¥${metrics.spend.toFixed(2)}`);
        console.log(`  Total Conversions: ${metrics.conversions}`);
        console.log(`  Date range: ${metrics.dates.length} days`);
        console.log();
      }

      // DBに保存されているメトリクスと比較
      console.log('\n=== Comparing with DB Metrics ===\n');

      for (const [adId] of Array.from(adMetricsMap.entries()).slice(0, 3)) {
        const ad = await prisma.ad.findUnique({
          where: { tiktokId: String(adId) },
        });

        if (!ad) {
          console.log(`Ad ${adId}: NOT FOUND IN DB`);
          continue;
        }

        const dbMetrics = await prisma.metric.findMany({
          where: {
            adId: ad.id,
            statDate: {
              gte: startDate,
              lte: endDate,
            },
          },
        });

        const totalSpend = dbMetrics.reduce((sum, m) => sum + m.spend, 0);
        const totalImpressions = dbMetrics.reduce((sum, m) => sum + m.impressions, 0);

        console.log(`Ad: ${ad.name}`);
        console.log(`  DB Metrics: ${dbMetrics.length} records`);
        console.log(`  DB Total Impressions: ${totalImpressions}`);
        console.log(`  DB Total Spend: ¥${totalSpend.toFixed(2)}`);
        console.log();
      }
    } else {
      console.log('No metrics data returned from API');
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

testSmartPlusMetrics();
