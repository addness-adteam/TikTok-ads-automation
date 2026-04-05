import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

/**
 * Smart+ 広告の同期処理をテスト（creative_list対応版）
 */
async function testSmartPlusSyncFixed() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('Smart+ Ads Sync Test (Fixed)');
  console.log('========================================');
  console.log(`Advertiser ID: ${advertiserId}\n`);

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

  console.log(`V Advertiser found: ${advertiser.name}\n`);

  try {
    const smartPlusAdsResult = await tiktokService.getSmartPlusAds(
      advertiserId,
      token.accessToken,
    );

    const smartPlusAds = smartPlusAdsResult.data?.list || [];
    console.log(`V Retrieved ${smartPlusAds.length} Smart+ ads\n`);

    let smartPlusAdsSynced = 0;
    let skippedNoId = 0;
    let skippedNoAdgroup = 0;
    let skippedNoCreative = 0;
    let errors = 0;

    for (const ad of smartPlusAds.slice(0, 10)) { // 最初の10件でテスト
      const adId = ad.smart_plus_ad_id || ad.ad_id;
      if (!adId) {
        console.log(`X Smart+ ad has no ID, skipping`);
        skippedNoId++;
        continue;
      }

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

      // Creativeを処理（creative_list から取得）
      let creativeId: string | null = null;

      const creativeList = ad.creative_list || [];
      const enabledCreative = creativeList.find(
        (c: any) => c.material_operation_status === 'ENABLE'
      );

      if (enabledCreative?.creative_info) {
        const creativeInfo = enabledCreative.creative_info;
        const videoId = creativeInfo.video_info?.video_id;
        const imageInfo = creativeInfo.image_info;

        if (videoId) {
          const creative = await prisma.creative.findFirst({
            where: { tiktokVideoId: videoId },
          });

          if (!creative) {
            const newCreative = await prisma.creative.create({
              data: {
                advertiserId: advertiser.id,
                name: creativeInfo.material_name || `Video ${videoId}`,
                type: 'VIDEO',
                tiktokVideoId: videoId,
                url: videoId || '',
                filename: `video_${videoId}`,
              },
            });
            creativeId = newCreative.id;
            console.log(`  Created new creative: ${creativeInfo.material_name || videoId}`);
          } else {
            creativeId = creative.id;
          }
        } else if (imageInfo && imageInfo.length > 0) {
          const imageId = imageInfo[0].web_uri || imageInfo[0].image_id;

          if (imageId) {
            const creative = await prisma.creative.findFirst({
              where: { tiktokImageId: imageId },
            });

            if (!creative) {
              const newCreative = await prisma.creative.create({
                data: {
                  advertiserId: advertiser.id,
                  name: creativeInfo.material_name || `Image ${imageId}`,
                  type: 'IMAGE',
                  tiktokImageId: imageId,
                  url: imageId || '',
                  filename: `image_${imageId}`,
                },
              });
              creativeId = newCreative.id;
              console.log(`  Created new creative: ${creativeInfo.material_name || imageId}`);
            } else {
              creativeId = creative.id;
            }
          }
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
            adText: ad.ad_text_list?.[0]?.ad_text,
            callToAction: ad.ad_configuration?.call_to_action_id,
            landingPageUrl: ad.landing_page_url_list?.[0]?.landing_page_url,
            displayName: enabledCreative?.creative_info?.identity_id,
            status: ad.operation_status,
            reviewStatus: 'APPROVED',
          },
          update: {
            name: ad.ad_name,
            adText: ad.ad_text_list?.[0]?.ad_text,
            callToAction: ad.ad_configuration?.call_to_action_id,
            landingPageUrl: ad.landing_page_url_list?.[0]?.landing_page_url,
            displayName: enabledCreative?.creative_info?.identity_id,
            status: ad.operation_status,
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
    console.log('Summary (first 10 ads):');
    console.log('========================================');
    console.log(`Successfully synced: ${smartPlusAdsSynced}`);
    console.log(`Skipped (no ID): ${skippedNoId}`);
    console.log(`Skipped (no adgroup): ${skippedNoAdgroup}`);
    console.log(`Skipped (no creative): ${skippedNoCreative}`);
    console.log(`Errors: ${errors}`);

  } catch (error: any) {
    console.log(`X Error: ${error.message}`);
    if (error.response) {
      console.log('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }

  await app.close();
}

testSmartPlusSyncFixed();
