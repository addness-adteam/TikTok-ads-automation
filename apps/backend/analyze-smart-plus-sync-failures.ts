import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

/**
 * Smart+ 広告の同期失敗を詳細分析
 */
async function analyzeSmartPlusSyncFailures() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('Smart+ Ads Sync Failure Analysis');
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
    const smartPlusAdsResult = await tiktokService.getSmartPlusAds(
      advertiserId,
      token.accessToken,
    );

    const smartPlusAds = smartPlusAdsResult.data?.list || [];
    console.log(`Total Smart+ ads from API: ${smartPlusAds.length}\n`);

    // 配信中の広告のみフィルタ
    const activeAds = smartPlusAds.filter((ad: any) => ad.operation_status === 'ENABLE');
    console.log(`Active Smart+ ads (ENABLE): ${activeAds.length}\n`);

    let successCount = 0;
    let skipReasons: Record<string, number> = {
      'no_id': 0,
      'no_adgroup_id': 0,
      'adgroup_not_in_db': 0,
      'no_creative_list': 0,
      'no_enabled_creative': 0,
      'no_video_or_image': 0,
    };

    const adgroupNotFoundList: string[] = [];

    for (const ad of activeAds) {
      const adId = ad.smart_plus_ad_id || ad.ad_id;

      if (!adId) {
        skipReasons['no_id']++;
        continue;
      }

      if (!ad.adgroup_id) {
        skipReasons['no_adgroup_id']++;
        continue;
      }

      const adgroup = await prisma.adGroup.findUnique({
        where: { tiktokId: String(ad.adgroup_id) },
      });

      if (!adgroup) {
        skipReasons['adgroup_not_in_db']++;
        adgroupNotFoundList.push(ad.adgroup_id);
        continue;
      }

      // Creative処理
      const creativeList = ad.creative_list || [];
      if (creativeList.length === 0) {
        skipReasons['no_creative_list']++;
        continue;
      }

      const enabledCreative = creativeList.find(
        (c: any) => c.material_operation_status === 'ENABLE'
      );

      if (!enabledCreative) {
        skipReasons['no_enabled_creative']++;
        continue;
      }

      const creativeInfo = enabledCreative.creative_info;
      const videoId = creativeInfo?.video_info?.video_id;
      const imageInfo = creativeInfo?.image_info;

      if (!videoId && (!imageInfo || imageInfo.length === 0)) {
        skipReasons['no_video_or_image']++;
        continue;
      }

      successCount++;
    }

    console.log('========================================');
    console.log('Analysis Results:');
    console.log('========================================');
    console.log(`Total Active Smart+ Ads: ${activeAds.length}`);
    console.log(`Successfully processable: ${successCount}`);
    console.log(`Total skipped: ${activeAds.length - successCount}\n`);

    console.log('Skip Reasons:');
    console.log(`  No ID: ${skipReasons.no_id}`);
    console.log(`  No AdGroup ID: ${skipReasons.no_adgroup_id}`);
    console.log(`  AdGroup not in DB: ${skipReasons.adgroup_not_in_db}`);
    console.log(`  No creative_list: ${skipReasons.no_creative_list}`);
    console.log(`  No enabled creative: ${skipReasons.no_enabled_creative}`);
    console.log(`  No video or image: ${skipReasons.no_video_or_image}\n`);

    if (adgroupNotFoundList.length > 0) {
      console.log('========================================');
      console.log('Missing AdGroups Analysis:');
      console.log('========================================');
      const uniqueAdgroups = [...new Set(adgroupNotFoundList)];
      console.log(`Unique missing AdGroups: ${uniqueAdgroups.length}\n`);

      // 全AdGroupを一度だけ取得
      console.log('Fetching all AdGroups from API...');
      const adgroupsResponse = await tiktokService.getAdGroups(
        advertiserId,
        token.accessToken,
      );
      const allAdgroups = adgroupsResponse.data?.list || [];
      console.log(`Total AdGroups from API: ${allAdgroups.length}\n`);

      console.log('First 10 missing AdGroups:\n');
      for (const adgroupId of uniqueAdgroups.slice(0, 10)) {
        const adgroup = allAdgroups.find((ag: any) => ag.adgroup_id === adgroupId);

        if (adgroup) {
          console.log(`AdGroup ${adgroupId}:`);
          console.log(`  Name: ${adgroup.adgroup_name}`);
          console.log(`  Status: ${adgroup.operation_status}`);
          console.log(`  Campaign: ${adgroup.campaign_id}\n`);
        } else {
          console.log(`AdGroup ${adgroupId}: NOT FOUND in API\n`);
        }
      }
    }

  } catch (error: any) {
    console.log(`X Error: ${error.message}`);
    if (error.response) {
      console.log('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }

  await app.close();
}

analyzeSmartPlusSyncFailures();
