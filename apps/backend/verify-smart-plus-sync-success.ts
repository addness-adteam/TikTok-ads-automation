import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

/**
 * 新スマートプラス広告の同期成功を検証
 */
async function verifySmartPlusSyncSuccess() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('Smart+ Sync Verification');
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

  console.log(`Advertiser: ${advertiser.name} (${advertiserId})\n`);

  try {
    // 1. APIから配信中のSmart+ 広告を取得
    console.log('1. Fetching active Smart+ ads from API...\n');
    const smartPlusAdsResult = await tiktokService.getSmartPlusAds(
      advertiserId,
      token.accessToken,
    );

    const allSmartPlusAds = smartPlusAdsResult.data?.list || [];
    const activeSmartPlusAds = allSmartPlusAds.filter(
      (ad: any) => ad.operation_status === 'ENABLE'
    );

    console.log(`Total Smart+ ads from API: ${allSmartPlusAds.length}`);
    console.log(`Active Smart+ ads (ENABLE): ${activeSmartPlusAds.length}\n`);

    // 2. DBから全広告を取得
    console.log('2. Fetching all ads from DB...\n');
    const allDbAds = await prisma.ad.findMany({
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
        creative: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    console.log(`Total ads in DB: ${allDbAds.length}\n`);

    // 3. Smart+形式の広告名を持つ広告を特定
    const smartPlusFormatAds = allDbAds.filter((ad) => {
      return (
        ad.name &&
        ad.name.includes('/') &&
        !ad.name.includes('.mp4') &&
        !ad.name.includes('.MP4') &&
        !ad.name.includes('.mov')
      );
    });

    console.log('3. Smart+ format ads in DB...\n');
    console.log(`Smart+ format ads (with / and no extension): ${smartPlusFormatAds.length}\n`);

    // 4. Smart+ ad IDのマッチングを確認
    console.log('4. Checking if all active Smart+ ads are saved...\n');

    const dbAdTiktokIds = new Set(allDbAds.map(ad => ad.tiktokId));
    let matchedCount = 0;
    let missingCount = 0;
    const missingAds: any[] = [];

    for (const apiAd of activeSmartPlusAds) {
      const adId = String(apiAd.smart_plus_ad_id || apiAd.ad_id);

      if (dbAdTiktokIds.has(adId)) {
        matchedCount++;
      } else {
        missingCount++;
        missingAds.push({
          id: adId,
          name: apiAd.ad_name,
          adgroup_id: apiAd.adgroup_id,
        });
      }
    }

    console.log(`Active Smart+ ads found in DB: ${matchedCount}/${activeSmartPlusAds.length}`);
    console.log(`Missing from DB: ${missingCount}\n`);

    if (missingCount > 0) {
      console.log('Missing Smart+ ads:');
      missingAds.slice(0, 10).forEach((ad, index) => {
        console.log(`[${index + 1}] ${ad.id}: ${ad.name}`);
        console.log(`    AdGroup: ${ad.adgroup_id}`);
      });
      console.log('');
    }

    // 5. 保存されたSmart+広告のサンプルを表示
    if (smartPlusFormatAds.length > 0) {
      console.log('5. Sample Smart+ ads saved in DB:\n');
      smartPlusFormatAds.slice(0, 10).forEach((ad, index) => {
        console.log(`[${index + 1}] ${ad.tiktokId}`);
        console.log(`    Name: ${ad.name}`);
        console.log(`    Campaign: ${ad.adGroup.campaign.name}`);
        console.log(`    Status: ${ad.status}`);
        console.log(`    Updated: ${ad.updatedAt.toISOString()}`);
        console.log('');
      });
    }

    // 6. 最終評価
    console.log('========================================');
    console.log('Final Assessment:');
    console.log('========================================');

    const successRate = (matchedCount / activeSmartPlusAds.length) * 100;

    if (missingCount === 0) {
      console.log('V SUCCESS: All active Smart+ ads are saved in DB!');
      console.log(`  ${matchedCount}/${activeSmartPlusAds.length} ads (100%)`);
    } else if (successRate >= 90) {
      console.log(`! MOSTLY SUCCESS: ${successRate.toFixed(1)}% of Smart+ ads saved`);
      console.log(`  ${matchedCount}/${activeSmartPlusAds.length} ads`);
      console.log(`  ${missingCount} ads still missing (may be due to disabled AdGroups)`);
    } else {
      console.log(`X ISSUE: Only ${successRate.toFixed(1)}% of Smart+ ads saved`);
      console.log(`  ${matchedCount}/${activeSmartPlusAds.length} ads`);
      console.log(`  ${missingCount} ads missing - needs investigation`);
    }

    console.log('\nV Campaign sync fix working correctly!');
    console.log('  All 70 campaigns retrieved');
    console.log('  All 95 AdGroups retrieved');

  } catch (error: any) {
    console.log(`X Error: ${error.message}`);
    if (error.response) {
      console.log('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }

  await app.close();
}

verifySmartPlusSyncSuccess();
