import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

/**
 * APIから取得した全Smart+広告がDBに存在するか確認
 */
async function verifyTotalSmartPlusCount() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('Total Smart+ Ads Verification');
  console.log('========================================\n');

  const token = await prisma.oAuthToken.findFirst({
    where: {
      advertiserId,
      expiresAt: { gt: new Date() },
    },
  });

  if (!token) {
    console.log('X No valid token found');
    await app.close();
    return;
  }

  const advertiser = await prisma.advertiser.findFirst({
    where: { tiktokAdvertiserId: advertiserId },
  });

  if (!advertiser) {
    console.log('X Advertiser not found in DB');
    await app.close();
    return;
  }

  try {
    // APIからSmart+広告を取得
    console.log('Fetching Smart+ ads from TikTok API...\n');
    const smartPlusAdsResult = await tiktokService.getSmartPlusAds(
      advertiserId,
      token.accessToken,
    );

    const apiSmartPlusAds = smartPlusAdsResult.data?.list || [];
    const activeApiAds = apiSmartPlusAds.filter(
      (ad: any) => ad.operation_status === 'ENABLE'
    );

    console.log(`API Smart+ ads: ${apiSmartPlusAds.length}`);
    console.log(`Active API Smart+ ads: ${activeApiAds.length}\n`);

    // DBから全広告を取得
    const allDbAds = await prisma.ad.findMany({
      where: {
        adGroup: {
          campaign: {
            advertiserId: advertiser.id,
          },
        },
      },
      select: {
        tiktokId: true,
        name: true,
        status: true,
      },
    });

    // APIのSmart+ ad IDsをSet化
    const apiAdIds = new Set(
      apiSmartPlusAds.map((ad: any) => String(ad.smart_plus_ad_id || ad.ad_id))
    );
    const activeApiAdIds = new Set(
      activeApiAds.map((ad: any) => String(ad.smart_plus_ad_id || ad.ad_id))
    );

    // DBにあるSmart+ ad IDsをカウント
    const dbSmartPlusAds = allDbAds.filter((ad) => apiAdIds.has(ad.tiktokId));
    const dbActiveSmartPlusAds = dbSmartPlusAds.filter(
      (ad) => ad.status === 'ENABLE'
    );

    console.log('========================================');
    console.log('Comparison Results:');
    console.log('========================================\n');
    console.log(`API Smart+ ads: ${apiSmartPlusAds.length}`);
    console.log(`DB Smart+ ads (matched by ID): ${dbSmartPlusAds.length}`);
    console.log(`Missing from DB: ${apiSmartPlusAds.length - dbSmartPlusAds.length}\n`);

    console.log(`Active API Smart+ ads: ${activeApiAds.length}`);
    console.log(`Active DB Smart+ ads: ${dbActiveSmartPlusAds.length}`);
    console.log(`Active missing from DB: ${activeApiAds.length - dbActiveSmartPlusAds.length}\n`);

    // 欠落している広告を表示
    if (dbSmartPlusAds.length < apiSmartPlusAds.length) {
      console.log('Missing ads:');
      const dbAdIds = new Set(dbSmartPlusAds.map((ad) => ad.tiktokId));
      const missingAdIds = Array.from(apiAdIds).filter(
        (id) => !dbAdIds.has(id as string)
      );

      for (const adId of missingAdIds.slice(0, 10)) {
        const apiAd = apiSmartPlusAds.find(
          (ad: any) => String(ad.smart_plus_ad_id || ad.ad_id) === adId
        );
        console.log(`  - ${adId}: ${apiAd?.ad_name || 'N/A'} (${apiAd?.operation_status})`);
      }
    } else {
      console.log('✅ All Smart+ ads from API are present in DB!');
    }

    // Smart+形式の名前（/を含む）の広告数
    const slashNamedAds = dbSmartPlusAds.filter((ad) =>
      ad.name?.includes('/')
    );
    console.log(`\nSmart+ ads with '/' in name: ${slashNamedAds.length}/${dbSmartPlusAds.length}`);

  } catch (error: any) {
    console.log(`\nX Error: ${error.message}`);
    if (error.stack) {
      console.log(error.stack);
    }
  }

  await app.close();
}

verifyTotalSmartPlusCount();
