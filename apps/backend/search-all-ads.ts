/**
 * 全広告（停止中含む）から検索
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  console.log('========================================');
  console.log('全広告から検索（停止中も含む）');
  console.log('========================================\n');

  try {
    // AI1アカウントを探す
    const advertiser = await prisma.advertiser.findFirst({
      where: {
        OR: [
          { name: { contains: 'AI_1' } },
          { name: { contains: 'ai_1' } },
        ]
      }
    });

    if (!advertiser) {
      console.log('❌ AI_1という名前のAdvertiserが見つかりませんでした');
      await app.close();
      return;
    }

    console.log(`✓ AI1アカウント: ${advertiser.name}`);
    console.log(`  Advertiser ID: ${advertiser.tiktokAdvertiserId}\n`);

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

    // 全広告を取得
    const adsResponse = await tiktokService.getAds(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );

    const allAds = adsResponse.data?.list || [];
    console.log(`取得した広告総数: ${allAds.length}\n`);

    // ステータス別集計
    const statusCounts = new Map<string, number>();
    allAds.forEach((ad: any) => {
      const status = ad.operation_status || 'UNKNOWN';
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    });

    console.log('ステータス別集計:');
    statusCounts.forEach((count, status) => {
      console.log(`  ${status}: ${count}件`);
    });

    // 広告ID 1849185525109761 を検索
    console.log('\n========================================');
    console.log('広告ID 1849185525109761 を検索');
    console.log('========================================\n');

    const targetId = '1849185525109761';
    const targetAd = allAds.find((ad: any) => ad.ad_id === targetId);

    if (targetAd) {
      console.log('✅ 見つかりました！\n');
      console.log(`Status: ${targetAd.operation_status}`);
      console.log(`Ad Name: ${targetAd.ad_name}`);
      console.log(`Campaign: ${targetAd.campaign_name}`);
      console.log(`Campaign Automation Type: ${targetAd.campaign_automation_type || 'N/A'}`);
    } else {
      console.log('❌ 見つかりませんでした');
    }

    // パース可能な広告名を持つ広告を検索
    console.log('\n========================================');
    console.log('パース可能な広告名を持つ広告を検索');
    console.log('========================================\n');

    const extensions = ['.mp4', '.MP4', '.mov', '.MOV', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG'];
    const parseableAds = allAds.filter((ad: any) => {
      const isCreativeName = extensions.some(ext => ad.ad_name && ad.ad_name.includes(ext));
      const parts = ad.ad_name ? ad.ad_name.split('/') : [];
      return parts.length >= 4 && !isCreativeName;
    });

    console.log(`パース可能な広告名: ${parseableAds.length}件\n`);

    if (parseableAds.length > 0) {
      console.log('サンプル（最大10件）:\n');
      parseableAds.slice(0, 10).forEach((ad: any, i: number) => {
        console.log(`[${i + 1}] ${ad.ad_name}`);
        console.log(`    Ad ID: ${ad.ad_id}`);
        console.log(`    Status: ${ad.operation_status}`);
        console.log(`    Campaign: ${ad.campaign_name}`);
        console.log(`    Campaign Automation Type: ${ad.campaign_automation_type || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('⚠️  パース可能な広告名を持つ広告は0件です');
    }

    // "堀江" を含む広告を検索
    console.log('\n========================================');
    console.log('"堀江" を含む広告');
    console.log('========================================\n');

    const horieAds = allAds.filter((ad: any) =>
      ad.ad_name && ad.ad_name.includes('堀江')
    );

    if (horieAds.length > 0) {
      horieAds.forEach((ad: any, i: number) => {
        console.log(`[${i + 1}] ${ad.ad_name}`);
        console.log(`    Ad ID: ${ad.ad_id}`);
        console.log(`    Status: ${ad.operation_status}`);
        console.log('');
      });
    } else {
      console.log('見つかりませんでした');
    }

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
