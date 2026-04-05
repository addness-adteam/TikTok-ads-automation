import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

/**
 * Smart+ 広告の同期処理をテスト
 */
async function testSmartPlusSync() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('Smart+ Ads Sync Test');
  console.log('========================================');
  console.log(`Advertiser ID: ${advertiserId}\n`);

  // Token取得
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

  console.log('V Access token retrieved\n');

  // Advertiser取得
  const advertiser = await prisma.advertiser.findFirst({
    where: { tiktokAdvertiserId: advertiserId },
  });

  if (!advertiser) {
    console.log('X Advertiser not found in DB');
    await app.close();
    return;
  }

  console.log(`V Advertiser found: ${advertiser.name}\n`);

  console.log('========================================');
  console.log('Step 1: Fetch Smart+ Ads from API');
  console.log('========================================\n');

  try {
    const smartPlusAdsResult = await tiktokService.getSmartPlusAds(
      advertiserId,
      token.accessToken,
    );

    const smartPlusAds = smartPlusAdsResult.data?.list || [];
    console.log(`V Retrieved ${smartPlusAds.length} Smart+ ads\n`);

    if (smartPlusAds.length === 0) {
      console.log('! No Smart+ ads found. Possible reasons:');
      console.log('  - No Smart+ ads in this account');
      console.log('  - API endpoint not returning data');
      console.log('  - Response structure is different\n');
      console.log('Raw response:');
      console.log(JSON.stringify(smartPlusAdsResult, null, 2));
      await app.close();
      return;
    }

    console.log('First 3 Smart+ ads from API:');
    smartPlusAds.slice(0, 3).forEach((ad: any, index: number) => {
      console.log(`\n[${index + 1}] Smart+ Ad ID: ${ad.smart_plus_ad_id}`);
      console.log(`    Ad ID: ${ad.ad_id || '(none)'}`);
      console.log(`    Name: ${ad.ad_name}`);
      console.log(`    Status: ${ad.operation_status}`);
      console.log(`    AdGroup ID: ${ad.adgroup_id || '(none)'}`);
      console.log(`    Campaign ID: ${ad.campaign_id || '(none)'}`);
      console.log(`    Video ID: ${ad.video_id || '(none)'}`);
      console.log(`    Image IDs: ${ad.image_ids?.join(', ') || '(none)'}`);
    });

    console.log('\n========================================');
    console.log('Step 2: Process Smart+ Ads for DB Sync');
    console.log('========================================\n');

    let smartPlusAdsSynced = 0;
    let skippedNoId = 0;
    let skippedNoAdgroup = 0;
    let skippedNoCreative = 0;
    let errors = 0;

    for (const ad of smartPlusAds) {
      // Smart+ AdのIDを決定
      const adId = ad.smart_plus_ad_id || ad.ad_id;
      if (!adId) {
        console.log(`X Smart+ ad has no ID, skipping`);
        skippedNoId++;
        continue;
      }

      // AdGroupを探す
      if (!ad.adgroup_id) {
        console.log(`X Smart+ ad ${adId} has no adgroup_id, skipping`);
        skippedNoAdgroup++;
        continue;
      }

      const adgroup = await prisma.adGroup.findUnique({
        where: { tiktokId: String(ad.adgroup_id) },
      });

      if (!adgroup) {
        console.log(`X AdGroup ${ad.adgroup_id} not found in DB for Smart+ ad ${adId}, skipping`);
        skippedNoAdgroup++;
        continue;
      }

      // Creativeを処理
      let creativeId: string | null = null;
      if (ad.video_id) {
        const creative = await prisma.creative.findFirst({
          where: { tiktokVideoId: ad.video_id },
        });

        if (!creative) {
          const newCreative = await prisma.creative.create({
            data: {
              advertiserId: advertiser.id,
              name: `Video ${ad.video_id}`,
              type: 'VIDEO',
              tiktokVideoId: ad.video_id,
              url: ad.video_id || '',
              filename: `video_${ad.video_id}`,
            },
          });
          creativeId = newCreative.id;
          console.log(`  Created new creative for video ${ad.video_id}`);
        } else {
          creativeId = creative.id;
        }
      } else if (ad.image_ids && ad.image_ids.length > 0) {
        const creative = await prisma.creative.findFirst({
          where: { tiktokImageId: ad.image_ids[0] },
        });

        if (!creative) {
          const newCreative = await prisma.creative.create({
            data: {
              advertiserId: advertiser.id,
              name: `Image ${ad.image_ids[0]}`,
              type: 'IMAGE',
              tiktokImageId: ad.image_ids[0],
              url: ad.image_ids[0] || '',
              filename: `image_${ad.image_ids[0]}`,
            },
          });
          creativeId = newCreative.id;
          console.log(`  Created new creative for image ${ad.image_ids[0]}`);
        } else {
          creativeId = creative.id;
        }
      }

      if (!creativeId) {
        console.log(`X No creative found for Smart+ ad ${adId}, skipping`);
        skippedNoCreative++;
        continue;
      }

      // Smart+ Adをupsert
      try {
        await prisma.ad.upsert({
          where: { tiktokId: String(adId) },
          create: {
            tiktokId: String(adId),
            adgroupId: adgroup.id,
            name: ad.ad_name,
            creativeId,
            adText: ad.ad_text,
            callToAction: ad.call_to_action,
            landingPageUrl: ad.landing_page_url,
            displayName: ad.identity_id,
            status: ad.operation_status,
            reviewStatus: ad.app_download_status || 'APPROVED',
          },
          update: {
            name: ad.ad_name,
            adText: ad.ad_text,
            callToAction: ad.call_to_action,
            landingPageUrl: ad.landing_page_url,
            displayName: ad.identity_id,
            status: ad.operation_status,
            reviewStatus: ad.app_download_status || 'APPROVED',
          },
        });
        console.log(`V Synced Smart+ ad ${adId}: ${ad.ad_name}`);
        smartPlusAdsSynced++;
      } catch (error: any) {
        console.log(`X Error syncing Smart+ ad ${adId}: ${error.message}`);
        errors++;
      }
    }

    console.log('\n========================================');
    console.log('Summary:');
    console.log('========================================');
    console.log(`Total Smart+ ads from API: ${smartPlusAds.length}`);
    console.log(`Successfully synced: ${smartPlusAdsSynced}`);
    console.log(`Skipped (no ID): ${skippedNoId}`);
    console.log(`Skipped (no adgroup): ${skippedNoAdgroup}`);
    console.log(`Skipped (no creative): ${skippedNoCreative}`);
    console.log(`Errors: ${errors}`);

  } catch (error: any) {
    console.log(`X Error fetching Smart+ ads: ${error.message}`);
    if (error.response) {
      console.log('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }

  await app.close();
}

testSmartPlusSync();
