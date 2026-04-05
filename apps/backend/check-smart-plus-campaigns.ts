import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

/**
 * Smart+ 広告のCampaignがDBに存在するか確認
 */
async function checkSmartPlusCampaigns() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('Smart+ Campaigns Check');
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
    // Smart+ 広告を取得
    const smartPlusAdsResult = await tiktokService.getSmartPlusAds(
      advertiserId,
      token.accessToken,
    );

    const smartPlusAds = smartPlusAdsResult.data?.list || [];
    const activeAds = smartPlusAds.filter((ad: any) => ad.operation_status === 'ENABLE');

    console.log(`Active Smart+ ads: ${activeAds.length}\n`);

    // ユニークなCampaign IDを取得
    const campaignIds = [...new Set(activeAds.map((ad: any) => ad.campaign_id))];
    console.log(`Unique Campaign IDs: ${campaignIds.length}\n`);

    let campaignsInDb = 0;
    let campaignsNotInDb = 0;

    for (const campaignId of campaignIds) {
      const campaign = await prisma.campaign.findUnique({
        where: { tiktokId: String(campaignId) },
      });

      if (campaign) {
        campaignsInDb++;
        console.log(`V Campaign ${campaignId} EXISTS in DB: ${campaign.name}`);
      } else {
        campaignsNotInDb++;
        console.log(`X Campaign ${campaignId} NOT in DB`);
      }
    }

    console.log('\n========================================');
    console.log('Summary:');
    console.log('========================================');
    console.log(`Campaigns in DB: ${campaignsInDb}`);
    console.log(`Campaigns NOT in DB: ${campaignsNotInDb}`);

    if (campaignsNotInDb > 0) {
      console.log('\n! Some Smart+ campaigns are missing in DB');
      console.log('This causes their AdGroups to be skipped during sync!');
    }

  } catch (error: any) {
    console.log(`X Error: ${error.message}`);
  }

  await app.close();
}

checkSmartPlusCampaigns();
