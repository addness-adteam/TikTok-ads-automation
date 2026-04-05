import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

/**
 * DBに保存された新スマートプラス広告を確認
 */
async function verifySmartPlusDbSync() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('Smart+ Ads DB Sync Verification');
  console.log('========================================');
  console.log(`Advertiser ID: ${advertiserId}\n`);

  // Advertiserを取得
  const advertiser = await prisma.advertiser.findFirst({
    where: { tiktokAdvertiserId: advertiserId },
  });

  if (!advertiser) {
    console.log('X Advertiser not found in DB');
    await app.close();
    return;
  }

  console.log(`V Advertiser found: ${advertiser.name}\n`);

  // 全広告を取得
  const allAds = await prisma.ad.findMany({
    where: {
      adGroup: {
        campaign: {
          advertiserId: advertiser.id,
        },
      },
    },
    include: {
      adGroup: {
        include: {
          campaign: true,
        },
      },
      metrics: {
        orderBy: { statDate: 'desc' },
        take: 1, // 最新のメトリクスのみ
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  console.log(`Total ads in DB: ${allAds.length}\n`);

  // Smart+ Ad ID の形式を判定（長い数値IDは smart_plus_ad_id の可能性が高い）
  const smartPlusAds = allAds.filter((ad) => {
    // smart_plus_ad_id は通常 18-19桁の数値
    return ad.tiktokId.length >= 16 && /^\d+$/.test(ad.tiktokId);
  });

  console.log(`Potential Smart+ ads (by ID pattern): ${smartPlusAds.length}\n`);

  // 手動広告名を持つ広告（新スマプラの特徴）
  const adsWithManualNames = smartPlusAds.filter((ad) => {
    return ad.name && ad.name.includes('/') && !ad.name.includes('.mp4') && !ad.name.includes('.MP4');
  });

  console.log(`Smart+ ads with manual names: ${adsWithManualNames.length}\n`);

  if (adsWithManualNames.length > 0) {
    console.log('========================================');
    console.log('Sample Smart+ Ads (first 10):');
    console.log('========================================\n');

    adsWithManualNames.slice(0, 10).forEach((ad, index) => {
      console.log(`[${index + 1}] Ad ID: ${ad.tiktokId}`);
      console.log(`    Name: ${ad.name}`);
      console.log(`    Status: ${ad.status}`);
      console.log(`    Campaign: ${ad.adGroup.campaign.name}`);
      console.log(`    Updated: ${ad.updatedAt.toISOString()}`);

      if (ad.metrics && ad.metrics.length > 0) {
        const metric = ad.metrics[0];
        console.log(`    Latest Metrics (${metric.statDate.toISOString().split('T')[0]}):`);
        console.log(`      - Spend: ${metric.spend} JPY`);
        console.log(`      - Conversions: ${metric.conversions}`);
        console.log(`      - CPA: ${metric.cpa} JPY`);
      } else {
        console.log(`    Metrics: No metrics found`);
      }
      console.log('');
    });
  }

  // 特定の広告ID（前回テストした広告）を確認
  const specificAdId = '1849212350625266';
  console.log('========================================');
  console.log(`Checking specific ad: ${specificAdId}`);
  console.log('========================================\n');

  const specificAd = await prisma.ad.findUnique({
    where: { tiktokId: specificAdId },
    include: {
      adGroup: {
        include: {
          campaign: true,
        },
      },
      metrics: {
        orderBy: { statDate: 'desc' },
        take: 5, // 最新5日分
      },
    },
  });

  if (specificAd) {
    console.log(`V Ad found in DB!`);
    console.log(`  Name: ${specificAd.name}`);
    console.log(`  Status: ${specificAd.status}`);
    console.log(`  Campaign: ${specificAd.adGroup.campaign.name}`);
    console.log(`  Updated: ${specificAd.updatedAt.toISOString()}\n`);

    if (specificAd.metrics && specificAd.metrics.length > 0) {
      console.log(`  Recent Metrics (${specificAd.metrics.length} days):`);
      specificAd.metrics.forEach((metric) => {
        console.log(`    ${metric.statDate.toISOString().split('T')[0]}: Spend=${metric.spend} JPY, CV=${metric.conversions}, CPA=${metric.cpa} JPY`);
      });
    } else {
      console.log(`  X No metrics found for this ad`);
    }
  } else {
    console.log(`X Ad not found in DB`);
  }

  console.log('\n========================================');
  console.log('Summary:');
  console.log('========================================');
  console.log(`Total ads: ${allAds.length}`);
  console.log(`Potential Smart+ ads: ${smartPlusAds.length}`);
  console.log(`Smart+ ads with manual names: ${adsWithManualNames.length}`);
  console.log(`Ads with metrics: ${allAds.filter(ad => ad.metrics.length > 0).length}`);

  await app.close();
}

verifySmartPlusDbSync();
