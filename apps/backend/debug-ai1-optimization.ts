/**
 * AI1アカウントの予算調整デバッグスクリプト
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';
import { OptimizationService } from './src/optimization/optimization.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);
  const optimizationService = app.get(OptimizationService);

  console.log('========================================');
  console.log('AI1アカウントの予算調整デバッグ');
  console.log('========================================\n');

  try {
    // アドネス株式会社_AI_1を探す
    const advertisers = await prisma.advertiser.findMany({
      where: {
        OR: [
          { name: { contains: 'AI_1' } },
          { name: { contains: 'ai_1' } },
        ]
      },
      include: {
        appeal: true,
      }
    });

    if (advertisers.length === 0) {
      console.log('❌ AI_1という名前のAdvertiserが見つかりませんでした');
      await app.close();
      return;
    }

    const advertiser = advertisers[0];
    console.log(`✓ AI1アカウント見つかりました: ${advertiser.name}`);
    console.log(`  Advertiser ID: ${advertiser.tiktokAdvertiserId}`);
    console.log(`  Appeal: ${advertiser.appeal?.name || 'なし'}\n`);

    if (!advertiser.appeal) {
      console.log('❌ Appealが設定されていません');
      await app.close();
      return;
    }

    // アクセストークンを取得
    const token = await prisma.oAuthToken.findFirst({
      where: {
        advertiserId: advertiser.tiktokAdvertiserId,
        expiresAt: { gt: new Date() }
      }
    });

    if (!token) {
      console.log('❌ 有効なアクセストークンが見つかりません');
      await app.close();
      return;
    }

    console.log('✓ アクセストークン取得成功\n');

    // Step 1: 広告を取得
    console.log('========================================');
    console.log('Step 1: 配信中の広告を取得');
    console.log('========================================');
    const adsResponse = await tiktokService.getAds(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );

    const allAds = adsResponse.data?.list || [];
    console.log(`✓ 全広告数: ${allAds.length}`);

    const activeAds = allAds.filter((ad: any) => ad.operation_status === 'ENABLE');
    console.log(`✓ 配信中の広告数: ${activeAds.length}\n`);

    if (activeAds.length === 0) {
      console.log('⚠️  配信中の広告が0件です');
      await app.close();
      return;
    }

    // Step 2: 新スマプラキャンペーンの特定
    console.log('========================================');
    console.log('Step 2: 新スマプラキャンペーンの特定');
    console.log('========================================');

    const isCreativeName = (adName: string | null | undefined): boolean => {
      if (!adName) return false;
      const extensions = ['.mp4', '.MP4', '.mov', '.MOV', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.gif', '.GIF', '.avi', '.AVI'];
      return extensions.some(ext => adName.includes(ext));
    };

    // 新スマプラキャンペーンの特定（251117/AI/天才Ver2/LP1-CR00656～CR00660など）
    const campaignsResponse = await tiktokService.getCampaigns(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );

    const allCampaigns = campaignsResponse.data?.list || [];
    const activeCampaigns = allCampaigns.filter((c: any) => c.operation_status === 'ENABLE');

    console.log(`✓ 配信中のキャンペーン数: ${activeCampaigns.length}\n`);

    // 新スマプラキャンペーンを探す（キャンペーン名に"251117"などが含まれる）
    const smartPlusCampaigns = activeCampaigns.filter((c: any) =>
      c.campaign_name && c.campaign_name.includes('251117')
    );

    console.log(`✓ 新スマプラキャンペーン候補: ${smartPlusCampaigns.length}件\n`);

    if (smartPlusCampaigns.length === 0) {
      console.log('⚠️  新スマプラキャンペーンが見つかりませんでした');
      console.log('\nキャンペーン名の例（最大5件）:');
      activeCampaigns.slice(0, 5).forEach((c: any, i: number) => {
        console.log(`  [${i + 1}] ${c.campaign_name}`);
      });
      await app.close();
      return;
    }

    // Step 3: 各キャンペーンの詳細分析
    console.log('========================================');
    console.log('Step 3: 新スマプラキャンペーンの詳細分析');
    console.log('========================================\n');

    for (const campaign of smartPlusCampaigns) {
      console.log(`\nキャンペーン: ${campaign.campaign_name}`);
      console.log(`  Campaign ID: ${campaign.campaign_id}`);
      console.log(`  Status: ${campaign.operation_status}`);

      // このキャンペーンの広告を取得
      const campaignAds = activeAds.filter((ad: any) => ad.campaign_id === campaign.campaign_id);
      console.log(`  配信中の広告数: ${campaignAds.length}`);

      if (campaignAds.length > 0) {
        console.log(`  \n  広告の詳細:`);
        campaignAds.slice(0, 3).forEach((ad: any, i: number) => {
          console.log(`    [${i + 1}] ${ad.ad_name}`);
          console.log(`        Ad ID: ${ad.ad_id}`);
          console.log(`        Status: ${ad.operation_status}`);
          console.log(`        CR名判定: ${isCreativeName(ad.ad_name) ? 'Yes' : 'No'}`);
        });
      }
    }

    // Step 4: 実際の予算調整を実行
    console.log('\n========================================');
    console.log('Step 4: 予算調整を実行');
    console.log('========================================\n');

    const result = await optimizationService.optimizeAdvertiser(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );

    console.log('\n========================================');
    console.log('実行結果');
    console.log('========================================');
    console.log(`Total Ads: ${result.totalAds}`);
    console.log(`Evaluated (Phase 1): ${result.evaluated}`);
    console.log(`Decisions (Phase 1): ${result.decisions}`);
    console.log(`Executed (Phase 1): ${result.executed}`);

    if (result.detailedLogs && result.detailedLogs.length > 0) {
      console.log('\nPhase 1 詳細ログ（最大10件）:');
      result.detailedLogs.slice(0, 10).forEach((log: any, i: number) => {
        console.log(`\n  [${i + 1}] ${log.adName}`);
        console.log(`      Action: ${log.action}`);
        console.log(`      Reason: ${log.reason}`);
        if (log.metrics) {
          console.log(`      Impressions: ${log.metrics.impressions || 0}`);
          console.log(`      Spend: ${log.metrics.spend || 0}`);
          console.log(`      CPA: ${log.metrics.cpa || 0}`);
          console.log(`      Front CPO: ${log.metrics.frontCpo || 0}`);
        }
      });
    } else {
      console.log('\n⚠️  Phase 1の詳細ログが0件です');
    }

    console.log(`\nSmart+ Campaigns (Phase 2): ${result.smartPlusCampaigns?.total || 0}`);

    if (result.smartPlusCampaigns?.results?.length > 0) {
      console.log('\nPhase 2 Results:');
      result.smartPlusCampaigns.results.forEach((r: any, i: number) => {
        console.log(`\n  [${i + 1}] ${r.campaignName}`);
        console.log(`      Action: ${r.action}`);
        console.log(`      Reason: ${r.reason}`);
      });
    }

    console.log('\n✓ デバッグ完了');

  } catch (error: any) {
    console.error('\n❌ エラーが発生しました:');
    console.error(error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
  } finally {
    await app.close();
  }
}

bootstrap();
