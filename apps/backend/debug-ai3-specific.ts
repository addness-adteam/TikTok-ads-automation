/**
 * AI3アカウントの予算調整デバッグスクリプト（AI_3用）
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
  console.log('AI3アカウントの予算調整デバッグ');
  console.log('========================================\n');

  try {
    // アドネス株式会社_AI_3を探す
    const advertisers = await prisma.advertiser.findMany({
      where: {
        OR: [
          { name: { contains: 'AI_3' } },
          { name: { contains: 'ai_3' } },
        ]
      },
      include: {
        appeal: true,
      }
    });

    if (advertisers.length === 0) {
      console.log('❌ AI_3という名前のAdvertiserが見つかりませんでした');
      await app.close();
      return;
    }

    const advertiser = advertisers[0];
    console.log(`✓ AI3アカウント見つかりました: ${advertiser.name}`);
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
      console.log('\n全広告のステータス:');
      allAds.slice(0, 10).forEach((ad: any, i: number) => {
        console.log(`  [${i + 1}] ${ad.ad_name || '(名前なし)'}`);
        console.log(`      Status: ${ad.operation_status}`);
        console.log(`      Campaign ID: ${ad.campaign_id}`);
      });
      await app.close();
      return;
    }

    // Step 2: 広告名の分析
    console.log('========================================');
    console.log('Step 2: 広告名の分析（Phase 1判定）');
    console.log('========================================');

    const isCreativeName = (adName: string | null | undefined): boolean => {
      if (!adName) return false;
      const extensions = ['.mp4', '.MP4', '.mov', '.MOV', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.gif', '.GIF', '.avi', '.AVI'];
      return extensions.some(ext => adName.includes(ext));
    };

    let adsWithNoName = 0;
    let adsWithCreativeName = 0;
    let adsWithManualName = 0;

    activeAds.forEach((ad: any) => {
      if (!ad.ad_name || ad.ad_name.trim() === '') {
        adsWithNoName++;
      } else if (isCreativeName(ad.ad_name)) {
        adsWithCreativeName++;
      } else {
        adsWithManualName++;
      }
    });

    console.log(`  広告名なし: ${adsWithNoName}件`);
    console.log(`  CR名（拡張子含む）: ${adsWithCreativeName}件 → Phase 2へ`);
    console.log(`  手動広告名: ${adsWithManualName}件 → Phase 1で処理\n`);

    if (adsWithManualName > 0) {
      console.log('手動広告名の例（最大10件）:');
      activeAds
        .filter((ad: any) => ad.ad_name && !isCreativeName(ad.ad_name))
        .slice(0, 10)
        .forEach((ad: any, i: number) => {
          console.log(`  [${i + 1}] ${ad.ad_name}`);
        });
      console.log('');
    }

    if (adsWithCreativeName > 0) {
      console.log('CR名の例（最大10件）:');
      activeAds
        .filter((ad: any) => isCreativeName(ad.ad_name))
        .slice(0, 10)
        .forEach((ad: any, i: number) => {
          console.log(`  [${i + 1}] ${ad.ad_name}`);
          console.log(`      Campaign ID: ${ad.campaign_id}`);
        });
      console.log('');
    }

    // Step 3: キャンペーンの分析
    console.log('========================================');
    console.log('Step 3: キャンペーンの分析（Phase 2判定）');
    console.log('========================================');

    const campaignsResponse = await tiktokService.getCampaigns(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );

    const allCampaigns = campaignsResponse.data?.list || [];
    const activeCampaigns = allCampaigns.filter((c: any) => c.operation_status === 'ENABLE');

    console.log(`✓ 配信中のキャンペーン数: ${activeCampaigns.length}\n`);

    // 各キャンペーンの広告名状況を確認
    console.log('キャンペーンごとの詳細（最大10件）:');
    for (const campaign of activeCampaigns.slice(0, 10)) {
      const campaignAds = activeAds.filter((ad: any) => ad.campaign_id === campaign.campaign_id);
      const allHaveCreativeNames = campaignAds.length > 0 && campaignAds.every((ad: any) => isCreativeName(ad.ad_name));
      const hasManualNames = campaignAds.some((ad: any) => ad.ad_name && !isCreativeName(ad.ad_name));

      console.log(`\nCampaign: ${campaign.campaign_name}`);
      console.log(`  Campaign ID: ${campaign.campaign_id}`);
      console.log(`  広告数: ${campaignAds.length}`);
      console.log(`  全てCR名: ${allHaveCreativeNames ? 'Yes (Phase 2対象候補)' : 'No'}`);
      console.log(`  手動広告名あり: ${hasManualNames ? 'Yes (Phase 1で処理済み、Phase 2でスキップ)' : 'No'}`);

      if (campaignAds.length > 0) {
        console.log(`  広告名サンプル:`);
        campaignAds.slice(0, 3).forEach((ad: any) => {
          console.log(`    - ${ad.ad_name || '(名前なし)'}`);
        });
      }
    }

    // Step 4: メトリクスの確認
    console.log('\n========================================');
    console.log('Step 4: メトリクスデータの確認');
    console.log('========================================');

    // 最近7日間のメトリクスを確認
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentMetrics = await prisma.metric.findMany({
      where: {
        statDate: { gte: sevenDaysAgo }
      },
      select: {
        entityType: true,
        statDate: true,
      },
      take: 10
    });

    console.log(`\n過去7日間のメトリクス数: ${recentMetrics.length}`);
    if (recentMetrics.length > 0) {
      console.log('メトリクスサンプル:');
      recentMetrics.slice(0, 5).forEach((m, i) => {
        console.log(`  [${i + 1}] Type: ${m.entityType}, Date: ${m.statDate.toISOString().split('T')[0]}`);
      });
    } else {
      console.log('⚠️  過去7日間のメトリクスが見つかりません');
    }

    // Step 5: 実際の予算調整を実行
    console.log('\n========================================');
    console.log('Step 5: 予算調整を実行');
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
      console.log('\nPhase 1 詳細ログ（最大5件）:');
      result.detailedLogs.slice(0, 5).forEach((log: any, i: number) => {
        console.log(`\n  [${i + 1}] ${log.adName}`);
        console.log(`      Action: ${log.action}`);
        console.log(`      Reason: ${log.reason}`);
        console.log(`      Impressions: ${log.metrics?.impressions || 0}`);
        console.log(`      Spend: ${log.metrics?.spend || 0}`);
      });
    }

    console.log(`\nSmart+ Campaigns (Phase 2): ${result.smartPlusCampaigns?.total || 0}`);

    if (result.smartPlusCampaigns?.results?.length > 0) {
      console.log('\nPhase 2 Results（最大5件）:');
      result.smartPlusCampaigns.results.slice(0, 5).forEach((r: any, i: number) => {
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
