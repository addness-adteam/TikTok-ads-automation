import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

/**
 * Campaign同期の問題を調査
 */
async function checkCampaignSyncIssue() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('Campaign Sync Issue Investigation');
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

  try {
    // 1. APIからCampaignを取得
    console.log('1. Fetching campaigns from API...\n');
    const campaignsResponse = await tiktokService.getCampaigns(
      advertiserId,
      token.accessToken,
    );

    console.log('API Response page_info:', JSON.stringify(campaignsResponse.data?.page_info, null, 2));
    console.log('');

    const campaigns = campaignsResponse.data?.list || [];
    const pageInfo = campaignsResponse.data?.page_info;

    console.log(`Retrieved Campaigns: ${campaigns.length}`);
    console.log(`Total Campaigns (from page_info): ${pageInfo?.total_number || 'N/A'}`);
    console.log(`Page: ${pageInfo?.page || 'N/A'}`);
    console.log(`Page Size: ${pageInfo?.page_size || 'N/A'}`);
    console.log(`Total Page: ${pageInfo?.total_page || 'N/A'}`);
    console.log('');

    if (pageInfo?.total_number && campaigns.length < pageInfo.total_number) {
      console.log('! WARNING: Not all campaigns were retrieved!');
      console.log(`  Missing Campaigns: ${pageInfo.total_number - campaigns.length}\n`);
    }

    // 2. Smart+ AdのCampaign IDを確認
    console.log('2. Fetching Smart+ ads to check their campaign IDs...\n');
    const smartPlusAdsResult = await tiktokService.getSmartPlusAds(
      advertiserId,
      token.accessToken,
    );

    const smartPlusAds = smartPlusAdsResult.data?.list || [];
    const activeSmartPlusAds = smartPlusAds.filter((ad: any) => ad.operation_status === 'ENABLE');

    console.log(`Active Smart+ Ads: ${activeSmartPlusAds.length}`);

    // Smart+ AdsのCampaign IDを抽出
    const smartPlusCampaignIds = [...new Set(activeSmartPlusAds.map((ad: any) => String(ad.campaign_id)))] as string[];
    console.log(`Unique Smart+ Campaign IDs: ${smartPlusCampaignIds.length}\n`);

    // 3. 取得されたCampaign一覧にSmart+ Campaign IDが含まれているか確認
    console.log('3. Checking if Smart+ campaigns are in the retrieved list...\n');

    const retrievedCampaignIds = new Set(campaigns.map((c: any) => String(c.campaign_id)));
    let foundCount = 0;
    let missingCount = 0;
    const missingCampaignIds: string[] = [];

    for (const campaignId of smartPlusCampaignIds) {
      if (retrievedCampaignIds.has(campaignId)) {
        foundCount++;
      } else {
        missingCount++;
        missingCampaignIds.push(campaignId);
      }
    }

    console.log(`Smart+ Campaigns found in API response: ${foundCount}`);
    console.log(`Smart+ Campaigns MISSING in API response: ${missingCount}\n`);

    if (missingCount > 0) {
      console.log('Missing Smart+ Campaign IDs:');
      missingCampaignIds.forEach((id: string) => console.log(`  - ${id}`));
      console.log('');
      console.log('! This is the root cause!');
      console.log('  getCampaigns() is not retrieving all campaigns due to missing page_size parameter.');
    }

  } catch (error: any) {
    console.log(`X Error: ${error.message}`);
    if (error.response) {
      console.log('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }

  await app.close();
}

checkCampaignSyncIssue();
