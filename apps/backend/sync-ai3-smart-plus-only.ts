import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

/**
 * AI_3のSmart+広告のみを同期（通常広告をスキップ）
 */
async function syncAI3SmartPlusOnly() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('AI_3 Smart+ Ads Only Sync');
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

  console.log(`Advertiser: ${advertiser.name}\n`);

  try {
    // Smart+ 広告を取得
    console.log('Fetching Smart+ ads from API...');
    const smartPlusAdsResult = await tiktokService.getSmartPlusAds(
      advertiserId,
      token.accessToken,
    );

    const smartPlusAds = smartPlusAdsResult.data?.list || [];
    console.log(`✓ Retrieved ${smartPlusAds.length} Smart+ ads\n`);

    // 配信中のみフィルタ（オプション）
    const activeAds = smartPlusAds.filter((ad: any) => ad.operation_status === 'ENABLE');
    console.log(`Active Smart+ ads: ${activeAds.length}\n`);

    let smartPlusAdsSynced = 0;
    let skippedNoId = 0;
    let skippedNoAdgroup = 0;
    let skippedAdgroupNotFound = 0;
    let skippedNoCreative = 0;
    let errors = 0;

    console.log('Starting sync...\n');

    for (const ad of smartPlusAds) {
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
        console.log(`X AdGroup ${ad.adgroup_id} not found for Smart+ ad ${adId}: ${ad.ad_name}`);
        skippedAdgroupNotFound++;
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
            } else {
              creativeId = creative.id;
            }
          }
        }
      }

      if (!creativeId) {
        console.log(`X No creative found for Smart+ ad ${adId}: ${ad.ad_name}`);
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

        console.log(`✓ [${smartPlusAdsSynced + 1}/${smartPlusAds.length}] Synced: ${ad.ad_name}`);
        smartPlusAdsSynced++;
      } catch (error: any) {
        console.log(`X Error syncing Smart+ ad ${adId}: ${error.message}`);
        errors++;
      }
    }

    console.log('\n========================================');
    console.log('Sync Summary:');
    console.log('========================================');
    console.log(`Total Smart+ ads from API: ${smartPlusAds.length}`);
    console.log(`Successfully synced: ${smartPlusAdsSynced}`);
    console.log(`Skipped (no ID): ${skippedNoId}`);
    console.log(`Skipped (no adgroup_id): ${skippedNoAdgroup}`);
    console.log(`Skipped (AdGroup not found): ${skippedAdgroupNotFound}`);
    console.log(`Skipped (no creative): ${skippedNoCreative}`);
    console.log(`Errors: ${errors}\n`);

    if (smartPlusAdsSynced > 0) {
      console.log(`✅ SUCCESS: Synced ${smartPlusAdsSynced} Smart+ ads!`);
    } else {
      console.log('❌ No Smart+ ads were synced. Check the logs above.');
    }

    // 最終確認
    const smartPlusAdsInDb = await prisma.ad.count({
      where: {
        adGroup: {
          campaign: {
            advertiserId: advertiser.id,
          },
        },
        name: {
          contains: '/',
        },
      },
    });

    console.log(`\nSmart+ format ads in DB: ${smartPlusAdsInDb}`);

  } catch (error: any) {
    console.log(`\nX Error: ${error.message}`);
    if (error.stack) {
      console.log(error.stack);
    }
  }

  await app.close();
}

syncAI3SmartPlusOnly();
