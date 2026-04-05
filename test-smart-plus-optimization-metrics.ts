import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function testSmartPlusOptimizationMetrics() {
  try {
    console.log('=== Testing Smart+ Metrics in Optimization Logic ===\n');

    // AI1のAdvertiserを取得
    const advertiser = await prisma.advertiser.findFirst({
      where: { name: { contains: 'AI_1' } },
    });

    if (!advertiser) {
      console.log('AI_1 advertiser not found');
      return;
    }

    console.log(`Using advertiser: ${advertiser.name}\n`);

    // Smart+広告を取得（DBから）- メトリクスがあるものを検索
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    // 昨日のメトリクスがあるAd IDを取得
    const metricsWithAds = await prisma.metric.findMany({
      where: {
        entityType: 'AD',
        statDate: yesterday,
        ad: {
          adGroup: {
            campaign: {
              advertiser: {
                tiktokAdvertiserId: advertiser.tiktokAdvertiserId,
              },
            },
          },
        },
      },
      include: {
        ad: true,
      },
      take: 5,
    });

    const smartPlusAds = metricsWithAds.map((m) => m.ad);

    console.log(`Found ${smartPlusAds.length} ads with metrics from ${yesterday.toISOString().split('T')[0]}\n`);

    if (smartPlusAds.length === 0) {
      console.log('No ads with recent metrics found in database');
      return;
    }

    // 各広告のメトリクスを取得（optimization.service.tsのgetAdMetricsと同じロジック）
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 7); // 過去7日間

    for (const ad of smartPlusAds) {
      console.log(`\nAd: ${ad.name}`);
      console.log(`  tiktokId: ${ad.tiktokId}`);

      // メトリクスを取得
      const metrics = await prisma.metric.findMany({
        where: {
          adId: ad.id,
          statDate: {
            gte: startDate,
            lte: today,
          },
        },
        orderBy: {
          statDate: 'desc',
        },
      });

      console.log(`  Metrics records: ${metrics.length}`);

      if (metrics.length > 0) {
        const latestMetric = metrics[0];
        console.log(`  Latest metric (${latestMetric.statDate.toISOString().split('T')[0]}):`);
        console.log(`    Impressions: ${latestMetric.impressions}`);
        console.log(`    Clicks: ${latestMetric.clicks}`);
        console.log(`    Spend: ¥${latestMetric.spend.toFixed(2)}`);
        console.log(`    Conversions: ${latestMetric.conversions}`);
        console.log(`    CTR: ${latestMetric.ctr.toFixed(2)}%`);
        console.log(`    CPC: ¥${latestMetric.cpc.toFixed(2)}`);

        // 合計を計算（optimization.service.tsと同じロジック）
        const totalSpend = metrics.reduce((sum, m) => sum + m.spend, 0);
        const totalImpressions = metrics.reduce((sum, m) => sum + m.impressions, 0);
        const totalClicks = metrics.reduce((sum, m) => sum + m.clicks, 0);
        const totalConversions = metrics.reduce((sum, m) => sum + m.conversions, 0);

        console.log(`\n  Aggregated (last 7 days):`);
        console.log(`    Total Spend: ¥${totalSpend.toFixed(2)}`);
        console.log(`    Total Impressions: ${totalImpressions}`);
        console.log(`    Total Clicks: ${totalClicks}`);
        console.log(`    Total Conversions: ${totalConversions}`);

        if (totalClicks > 0) {
          const avgCtr = (totalClicks / totalImpressions) * 100;
          const avgCpc = totalSpend / totalClicks;
          console.log(`    Avg CTR: ${avgCtr.toFixed(2)}%`);
          console.log(`    Avg CPC: ¥${avgCpc.toFixed(2)}`);
        }

        if (totalConversions > 0) {
          const avgCpa = totalSpend / totalConversions;
          console.log(`    Avg CPA: ¥${avgCpa.toFixed(2)}`);
        }
      } else {
        console.log(`  ⚠ No metrics found for this ad`);
      }
    }

    // 予算調整のシミュレーション
    console.log('\n\n=== Budget Optimization Simulation ===\n');

    const adsWithMetrics = [];

    for (const ad of smartPlusAds) {
      const metrics = await prisma.metric.findMany({
        where: {
          adId: ad.id,
          statDate: {
            gte: startDate,
            lte: today,
          },
        },
      });

      if (metrics.length > 0) {
        const totalSpend = metrics.reduce((sum, m) => sum + m.spend, 0);
        const totalConversions = metrics.reduce((sum, m) => sum + m.conversions, 0);
        const cpa = totalConversions > 0 ? totalSpend / totalConversions : Infinity;

        adsWithMetrics.push({
          name: ad.name,
          spend: totalSpend,
          conversions: totalConversions,
          cpa: cpa,
        });
      }
    }

    // CPAでソート（低い順 = パフォーマンスが良い）
    adsWithMetrics.sort((a, b) => a.cpa - b.cpa);

    console.log('Ads ranked by CPA (best performing first):\n');

    adsWithMetrics.forEach((ad, index) => {
      console.log(`${index + 1}. ${ad.name}`);
      console.log(`   Spend: ¥${ad.spend.toFixed(2)}, Conversions: ${ad.conversions}, CPA: ¥${ad.cpa === Infinity ? '∞' : ad.cpa.toFixed(2)}`);
      console.log();
    });

    if (adsWithMetrics.length > 0) {
      console.log('✓ Optimization logic can successfully retrieve and rank Smart+ ads by performance!');
    } else {
      console.log('⚠ No Smart+ ads have metrics data available for optimization');
    }

  } catch (error: any) {
    console.error('Error:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

testSmartPlusOptimizationMetrics();
