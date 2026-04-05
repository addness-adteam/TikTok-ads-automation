import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

/**
 * 欠落しているSmart+広告のAdGroupが存在するか調査
 */
async function investigateMissingSmartPlusAds() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('Missing Smart+ Ads Investigation');
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
    // 1. Smart+ 広告を取得
    console.log('1. Fetching Smart+ ads from API...\n');
    const smartPlusAdsResult = await tiktokService.getSmartPlusAds(
      advertiserId,
      token.accessToken,
    );

    const smartPlusAds = smartPlusAdsResult.data?.list || [];
    const activeSmartPlusAds = smartPlusAds.filter(
      (ad: any) => ad.operation_status === 'ENABLE'
    );

    console.log(`Active Smart+ ads: ${activeSmartPlusAds.length}\n`);

    // 2. DBに保存されているか確認
    const dbAdTiktokIds = new Set(
      (await prisma.ad.findMany({
        where: {
          adGroup: {
            campaign: {
              advertiserId: advertiser.id,
            },
          },
        },
        select: { tiktokId: true },
      })).map(ad => ad.tiktokId)
    );

    const missingAds: any[] = [];
    for (const apiAd of activeSmartPlusAds) {
      const adId = String(apiAd.smart_plus_ad_id || apiAd.ad_id);
      if (!dbAdTiktokIds.has(adId)) {
        missingAds.push(apiAd);
      }
    }

    console.log(`Missing ads: ${missingAds.length}\n`);

    // 3. 欠落している広告のAdGroupをチェック
    console.log('2. Checking AdGroups for missing ads...\n');

    let adgroupExistsInDb = 0;
    let adgroupMissingInDb = 0;
    let campaignMissingInDb = 0;
    const missingAdgroupIds: string[] = [];
    const missingCampaignIds: string[] = [];

    for (const ad of missingAds.slice(0, 10)) {
      const adId = ad.smart_plus_ad_id || ad.ad_id;
      const adgroupId = String(ad.adgroup_id);
      const campaignId = String(ad.campaign_id);

      // AdGroupがDBに存在するか
      const adgroup = await prisma.adGroup.findUnique({
        where: { tiktokId: adgroupId },
        include: { campaign: true },
      });

      console.log(`Ad ${adId}: ${ad.ad_name}`);

      if (adgroup) {
        adgroupExistsInDb++;
        console.log(`  V AdGroup ${adgroupId} EXISTS in DB`);
        console.log(`    AdGroup Name: ${adgroup.name}`);
        console.log(`    Campaign: ${adgroup.campaign.name}`);

        // AdGroupは存在するのに広告が保存されていない理由を調査
        const creativeList = ad.creative_list || [];
        const enabledCreative = creativeList.find(
          (c: any) => c.material_operation_status === 'ENABLE'
        );

        if (creativeList.length === 0) {
          console.log(`    X No creative_list`);
        } else if (!enabledCreative) {
          console.log(`    X No enabled creative (${creativeList.length} creatives, all disabled)`);
        } else {
          const videoId = enabledCreative.creative_info?.video_info?.video_id;
          const imageInfo = enabledCreative.creative_info?.image_info;

          if (videoId) {
            console.log(`    V Has video: ${videoId}`);
          } else if (imageInfo && imageInfo.length > 0) {
            console.log(`    V Has image: ${imageInfo[0].web_uri || imageInfo[0].image_id}`);
          } else {
            console.log(`    X No video or image found`);
          }
        }
      } else {
        adgroupMissingInDb++;
        missingAdgroupIds.push(adgroupId);
        console.log(`  X AdGroup ${adgroupId} NOT in DB`);

        // Campaignを確認
        const campaign = await prisma.campaign.findUnique({
          where: { tiktokId: campaignId },
        });

        if (campaign) {
          console.log(`    V Campaign ${campaignId} exists: ${campaign.name}`);
        } else {
          campaignMissingInDb++;
          missingCampaignIds.push(campaignId);
          console.log(`    X Campaign ${campaignId} NOT in DB`);
        }
      }
      console.log('');
    }

    console.log('========================================');
    console.log('Summary:');
    console.log('========================================');
    console.log(`Missing ads analyzed: ${Math.min(missingAds.length, 10)}`);
    console.log(`AdGroups that exist in DB: ${adgroupExistsInDb}`);
    console.log(`AdGroups missing from DB: ${adgroupMissingInDb}`);
    console.log(`Campaigns missing from DB: ${campaignMissingInDb}\n`);

    if (adgroupMissingInDb > 0) {
      console.log('! Issue: Some AdGroups are missing from DB');
      console.log('  This prevents their Smart+ ads from being saved');
      console.log('  Need to investigate why AdGroups were not synced\n');
    }

    if (adgroupExistsInDb > 0) {
      console.log('! Issue: Some AdGroups exist but ads were not saved');
      console.log('  Possible reasons:');
      console.log('  - No creative_list in API response');
      console.log('  - No enabled creative');
      console.log('  - No video or image in creative');
      console.log('  - Sync logic needs debugging\n');
    }

  } catch (error: any) {
    console.log(`X Error: ${error.message}`);
    if (error.response) {
      console.log('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }

  await app.close();
}

investigateMissingSmartPlusAds();
