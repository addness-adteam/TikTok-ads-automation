import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

/**
 * DBに保存されている広告名を確認
 */
async function checkAdNamesInDb() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const advertiserId = '7543540647266074641'; // AI_3

  // Advertiserを取得
  const advertiser = await prisma.advertiser.findFirst({
    where: { tiktokAdvertiserId: advertiserId },
  });

  if (!advertiser) {
    console.log('X Advertiser not found');
    await app.close();
    return;
  }

  // 広告を最新順で取得
  const ads = await prisma.ad.findMany({
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
    },
    orderBy: { updatedAt: 'desc' },
    take: 20, // 最新20件
  });

  console.log(`Latest 20 ads for ${advertiser.name}:\n`);

  ads.forEach((ad, index) => {
    console.log(`[${index + 1}] ${ad.tiktokId}`);
    console.log(`    Name: ${ad.name}`);
    console.log(`    Status: ${ad.status}`);
    console.log(`    Campaign: ${ad.adGroup.campaign.name}`);
    console.log(`    Updated: ${ad.updatedAt.toISOString()}`);
    console.log('');
  });

  // クリエイティブ名（拡張子含む）の広告を数える
  const creativeNameAds = ads.filter(ad =>
    ad.name && (ad.name.includes('.mp4') || ad.name.includes('.MP4') || ad.name.includes('.mov'))
  );

  console.log(`\nAds with creative names (file extensions): ${creativeNameAds.length}/${ads.length}`);

  await app.close();
}

checkAdNamesInDb();
