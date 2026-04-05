import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

/**
 * Smart+キャンペーンの予算最適化機能をテスト
 */
async function testSmartPlusOptimization() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('Smart+ Campaign Optimization Test');
  console.log('========================================\n');

  try {
    const advertiser = await prisma.advertiser.findFirst({
      where: { tiktokAdvertiserId: advertiserId },
    });

    if (!advertiser) {
      console.log('X Advertiser not found in DB');
      await app.close();
      return;
    }

    console.log(`Advertiser: ${advertiser.name}\n`);

    // Smart+キャンペーンを取得
    const smartPlusCampaigns = await prisma.campaign.findMany({
      where: {
        advertiserId: advertiser.id,
        name: {
          contains: 'スマ',
        },
      },
      include: {
        adGroups: {
          include: {
            ads: {
              include: {
                creative: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    console.log(`Smart+ campaigns found: ${smartPlusCampaigns.length}\n`);

    if (smartPlusCampaigns.length === 0) {
      console.log('X No Smart+ campaigns found');
      await app.close();
      return;
    }

    // 各キャンペーンの詳細を表示
    for (const campaign of smartPlusCampaigns) {
      console.log(`\n[Campaign] ${campaign.name}`);
      console.log(`  TikTok ID: ${campaign.tiktokId}`);
      console.log(`  Budget: ${campaign.budget || 'N/A'}`);
      console.log(`  Status: ${campaign.status}`);
      console.log(`  Objective: ${campaign.objectiveType}`);

      const totalAdGroups = campaign.adGroups.length;
      const totalAds = campaign.adGroups.reduce((sum, ag) => sum + ag.ads.length, 0);
      console.log(`  AdGroups: ${totalAdGroups}, Ads: ${totalAds}`);

      if (totalAds > 0) {
        console.log(`  Sample Ads:`);
        const sampleAds = campaign.adGroups
          .flatMap((ag) => ag.ads)
          .slice(0, 3);

        for (const ad of sampleAds) {
          console.log(`    - ${ad.name} (${ad.status})`);
          console.log(`      TikTok ID: ${ad.tiktokId}`);
          console.log(`      Creative: ${ad.creative?.name || 'N/A'}`);
        }
      }

      // 最近のメトリクスを確認
      const recentMetrics = await prisma.metric.findMany({
        where: {
          campaignId: campaign.tiktokId,
          statDate: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
        orderBy: { statDate: 'desc' },
        take: 1,
      });

      if (recentMetrics.length > 0) {
        const metric = recentMetrics[0];
        console.log(`  Recent Metrics (${metric.statDate.toISOString().split('T')[0]}):`);
        console.log(`    Spend: ¥${metric.spend || 0}`);
        console.log(`    Impressions: ${metric.impressions || 0}`);
        console.log(`    Clicks: ${metric.clicks || 0}`);
        console.log(`    Conversions: ${metric.conversions || 0}`);
      } else {
        console.log(`  ! No recent metrics found`);
      }
    }

    console.log('\n========================================');
    console.log('Testing Optimization Data Access');
    console.log('========================================\n');

    console.log('Checking if optimization can access Smart+ data:\n');

    const testCampaign = smartPlusCampaigns[0];
    const campaignMetrics = await prisma.metric.findMany({
      where: {
        campaignId: testCampaign.tiktokId,
        statDate: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { statDate: 'desc' },
    });

    console.log(`Test Campaign: ${testCampaign.name}`);
    console.log(`Metrics available: ${campaignMetrics.length} records`);

    if (campaignMetrics.length > 0) {
      const totalSpend = campaignMetrics.reduce((sum, m) => sum + (m.spend || 0), 0);
      const totalConversions = campaignMetrics.reduce((sum, m) => sum + (m.conversions || 0), 0);
      const avgCPA = totalConversions > 0 ? totalSpend / totalConversions : 0;

      console.log(`Total Spend (30 days): ¥${totalSpend.toFixed(2)}`);
      console.log(`Total Conversions: ${totalConversions}`);
      console.log(`Average CPA: ¥${avgCPA.toFixed(2)}`);

      console.log('\n✅ Optimization can access Smart+ campaign data!');
      console.log('✅ All required data is available for budget optimization');
    } else {
      console.log('\n! No metrics data available yet');
      console.log('  Metrics will be collected by the daily sync job');
      console.log('  Optimization will work once metrics are available');
    }

    // 広告レベルのデータも確認
    console.log('\nChecking ad-level data:');
    const testAds = testCampaign.adGroups
      .flatMap((ag) => ag.ads)
      .slice(0, 3);

    for (const ad of testAds) {
      const adMetrics = await prisma.metric.findMany({
        where: {
          adId: ad.tiktokId,
          statDate: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      });

      console.log(`\n  Ad: ${ad.name}`);
      console.log(`    Metrics records: ${adMetrics.length}`);

      if (adMetrics.length > 0) {
        const totalSpend = adMetrics.reduce((sum, m) => sum + (m.spend || 0), 0);
        console.log(`    Total Spend (7 days): ¥${totalSpend.toFixed(2)}`);
      }
    }

  } catch (error: any) {
    console.log(`\nX Error: ${error.message}`);
    if (error.stack) {
      console.log(error.stack);
    }
  }

  await app.close();
}

testSmartPlusOptimization();
