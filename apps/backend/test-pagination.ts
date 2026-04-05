/**
 * ページネーション対応メソッドのテスト
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  console.log('========================================');
  console.log('ページネーション対応メソッドのテスト');
  console.log('========================================\n');

  try {
    // AI_1アカウントでテスト
    const advertiser = await prisma.advertiser.findFirst({
      where: { name: { contains: 'AI_1' } }
    });

    if (!advertiser) {
      console.log('❌ AI_1アカウントが見つかりません');
      await app.close();
      return;
    }

    const token = await prisma.oAuthToken.findFirst({
      where: {
        advertiserId: advertiser.tiktokAdvertiserId,
        expiresAt: { gt: new Date() }
      }
    });

    if (!token) {
      console.log('❌ 有効なトークンがありません');
      await app.close();
      return;
    }

    console.log(`テスト対象: ${advertiser.name}\n`);

    // getAllCampaignsのテスト
    console.log('1. getAllCampaigns...');
    const campaigns = await tiktokService.getAllCampaigns(
      token.advertiserId,
      token.accessToken
    );
    console.log(`   → ${campaigns.length}件取得\n`);

    // getAllAdGroupsのテスト
    console.log('2. getAllAdGroups...');
    const adgroups = await tiktokService.getAllAdGroups(
      token.advertiserId,
      token.accessToken
    );
    console.log(`   → ${adgroups.length}件取得\n`);

    // getAllAdsのテスト
    console.log('3. getAllAds...');
    const ads = await tiktokService.getAllAds(
      token.advertiserId,
      token.accessToken
    );
    console.log(`   → ${ads.length}件取得\n`);

    // getAllSmartPlusAdsのテスト
    console.log('4. getAllSmartPlusAds...');
    const smartPlusAds = await tiktokService.getAllSmartPlusAds(
      token.advertiserId,
      token.accessToken
    );
    console.log(`   → ${smartPlusAds.length}件取得\n`);

    console.log('========================================');
    console.log('結果サマリー');
    console.log('========================================');
    console.log(`Campaigns: ${campaigns.length}件`);
    console.log(`AdGroups: ${adgroups.length}件`);
    console.log(`Ads: ${ads.length}件`);
    console.log(`Smart+ Ads: ${smartPlusAds.length}件`);

    // 以前の問題（100件制限）が解消されたか確認
    if (adgroups.length > 100) {
      console.log('\n✓ AdGroupsが100件を超えているので、ページネーションが正しく動作しています！');
    }

  } catch (error: any) {
    console.error('❌ エラー:', error.message);
  } finally {
    await app.close();
  }
}

main();
