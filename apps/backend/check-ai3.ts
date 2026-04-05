import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';
import { OptimizationService } from './src/optimization/optimization.service';

async function check() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);
  const optimizationService = app.get(OptimizationService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('AI3アカウント調査');
  console.log('========================================');
  console.log(`Advertiser ID: ${advertiserId}\n`);

  const advertiser = await prisma.advertiser.findUnique({
    where: { tiktokAdvertiserId: advertiserId },
    include: { appeal: true }
  });

  console.log(`Advertiser: ${advertiser?.name}`);
  console.log(`Appeal: ${advertiser?.appeal?.name || 'なし'}\n`);

  const token = await prisma.oAuthToken.findFirst({
    where: { advertiserId, expiresAt: { gt: new Date() } }
  });

  if (!token) {
    console.log('❌ トークンなし');
    await app.close();
    return;
  }

  console.log('✓ トークン取得成功\n');

  // 広告取得
  const adsResponse = await tiktokService.getAds(advertiserId, token.accessToken);
  const allAds = adsResponse.data?.list || [];
  const activeAds = allAds.filter((ad: any) => ad.operation_status === 'ENABLE');

  console.log(`全広告数: ${allAds.length}`);
  console.log(`配信中: ${activeAds.length}\n`);

  if (activeAds.length > 0) {
    console.log('配信中の広告例（最初の10件）:');
    activeAds.slice(0, 10).forEach((ad: any, i: number) => {
      console.log(`[${i+1}] ${ad.ad_name || '(名前なし)'}`);
      console.log(`    Status: ${ad.operation_status}`);
      console.log(`    Campaign: ${ad.campaign_id}`);
    });
  }

  // CR名判定
  const isCreativeName = (adName: string | null | undefined): boolean => {
    if (!adName) return false;
    const extensions = ['.mp4', '.MP4', '.mov', '.MOV', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.gif', '.GIF', '.avi', '.AVI'];
    return extensions.some(ext => adName.includes(ext));
  };

  const stats = {
    noName: 0,
    creativeName: 0,
    manualName: 0
  };

  activeAds.forEach((ad: any) => {
    if (!ad.ad_name || ad.ad_name.trim() === '') {
      stats.noName++;
    } else if (isCreativeName(ad.ad_name)) {
      stats.creativeName++;
    } else {
      stats.manualName++;
    }
  });

  console.log('\n========================================');
  console.log('広告名の分類');
  console.log('========================================');
  console.log(`広告名なし: ${stats.noName}件`);
  console.log(`CR名（拡張子含む）: ${stats.creativeName}件 → Phase 2へ`);
  console.log(`手動広告名: ${stats.manualName}件 → Phase 1で処理\n`);

  // 予算調整実行
  console.log('========================================');
  console.log('予算調整を実行');
  console.log('========================================\n');

  const result = await optimizationService.optimizeAdvertiser(advertiserId, token.accessToken);

  console.log(`Total Ads: ${result.totalAds}`);
  console.log(`Evaluated (Phase 1): ${result.evaluated}`);
  console.log(`Decisions: ${result.decisions}`);
  console.log(`Smart+ Campaigns (Phase 2): ${result.smartPlusCampaigns?.total || 0}`);

  await app.close();
}

check();
