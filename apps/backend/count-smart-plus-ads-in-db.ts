import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

/**
 * DBに保存された新スマプラ広告をカウント
 */
async function countSmartPlusAdsInDb() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const advertiserId = '7543540647266074641'; // AI_3

  const advertiser = await prisma.advertiser.findFirst({
    where: { tiktokAdvertiserId: advertiserId },
  });

  if (!advertiser) {
    console.log('X Advertiser not found');
    await app.close();
    return;
  }

  // 全広告を取得
  const allAds = await prisma.ad.findMany({
    where: {
      adGroup: {
        campaign: {
          advertiserId: advertiser.id,
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  console.log(`Total ads in DB: ${allAds.length}\n`);

  // 新スマプラ形式の広告名（/を含み、拡張子を含まない）
  const smartPlusFormatAds = allAds.filter((ad) => {
    return (
      ad.name &&
      ad.name.includes('/') &&
      !ad.name.includes('.mp4') &&
      !ad.name.includes('.MP4') &&
      !ad.name.includes('.mov')
    );
  });

  console.log(`Smart+ format ads (with / and no extension): ${smartPlusFormatAds.length}\n`);

  if (smartPlusFormatAds.length > 0) {
    console.log('Sample Smart+ ads (first 10):');
    smartPlusFormatAds.slice(0, 10).forEach((ad, index) => {
      console.log(`[${index + 1}] ${ad.tiktokId}: ${ad.name}`);
      console.log(`    Updated: ${ad.updatedAt.toISOString()}`);
    });
  } else {
    console.log('X No Smart+ format ads found in DB');
    console.log('\nMost recently updated ads:');
    allAds.slice(0, 5).forEach((ad) => {
      console.log(`- ${ad.tiktokId}: ${ad.name}`);
      console.log(`  Updated: ${ad.updatedAt.toISOString()}`);
    });
  }

  await app.close();
}

countSmartPlusAdsInDb();
