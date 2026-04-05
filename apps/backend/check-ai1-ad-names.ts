/**
 * AI1アカウントの広告名を確認するスクリプト
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
  console.log('AI1アカウントの広告名を確認');
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

    // 広告を取得
    const adsResponse = await tiktokService.getAds(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );

    const allAds = adsResponse.data?.list || [];
    console.log(`✓ 全広告数: ${allAds.length}\n`);

    // 配信中の広告のみフィルタ
    const activeAds = allAds.filter((ad: any) => ad.operation_status === 'ENABLE');
    console.log(`✓ 配信中の広告数: ${activeAds.length}\n`);

    // 新スマプラキャンペーン「251117/AI/天才Ver2/LP1-CR00656～CR00660」の広告を確認
    const targetCampaignId = '1849008461509889';
    const targetAds = activeAds.filter((ad: any) => ad.campaign_id === targetCampaignId);

    console.log('========================================');
    console.log(`キャンペーン: 251117/AI/天才Ver2/LP1-CR00656～CR00660`);
    console.log(`Campaign ID: ${targetCampaignId}`);
    console.log('========================================\n');

    if (targetAds.length === 0) {
      console.log('⚠️  このキャンペーンの配信中の広告が見つかりません');
    } else {
      console.log(`配信中の広告数: ${targetAds.length}\n`);

      targetAds.forEach((ad: any, index: number) => {
        console.log(`広告 ${index + 1}:`);
        console.log(`  Ad ID: ${ad.ad_id}`);
        console.log(`  Ad Name (ad_name): ${ad.ad_name}`);
        console.log(`  Status: ${ad.operation_status}`);

        // 他のフィールドも確認
        if (ad.ad_text) {
          console.log(`  Ad Text: ${ad.ad_text.substring(0, 50)}...`);
        }
        if (ad.video_id) {
          console.log(`  Video ID: ${ad.video_id}`);
        }
        if (ad.image_ids) {
          console.log(`  Image IDs: ${ad.image_ids}`);
        }

        // ad_nameがCR名かどうか確認
        const extensions = ['.mp4', '.MP4', '.mov', '.MOV', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.gif', '.GIF'];
        const isCreativeName = extensions.some(ext => ad.ad_name && ad.ad_name.includes(ext));
        console.log(`  CR名判定: ${isCreativeName ? 'Yes (CR名)' : 'No (手動設定された広告名)'}`);

        // 広告名のパース可能性チェック
        const parts = ad.ad_name ? ad.ad_name.split('/') : [];
        const isParseable = parts.length >= 4;
        console.log(`  パース可能: ${isParseable ? 'Yes' : 'No'}`);
        if (isParseable) {
          console.log(`    出稿日: ${parts[0]}`);
          console.log(`    制作者: ${parts[1]}`);
          console.log(`    CR名: ${parts.slice(2, parts.length - 1).join('/')}`);
          console.log(`    LP名: ${parts[parts.length - 1]}`);
        }

        console.log('');
      });
    }

    console.log('\n========================================');
    console.log('全配信中広告の広告名サンプル（最大10件）');
    console.log('========================================\n');

    activeAds.slice(0, 10).forEach((ad: any, index: number) => {
      const extensions = ['.mp4', '.MP4', '.mov', '.MOV', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.gif', '.GIF'];
      const isCreativeName = extensions.some(ext => ad.ad_name && ad.ad_name.includes(ext));
      const parts = ad.ad_name ? ad.ad_name.split('/') : [];
      const isParseable = parts.length >= 4;

      console.log(`[${index + 1}] ${ad.ad_name}`);
      console.log(`    Campaign ID: ${ad.campaign_id}`);
      console.log(`    CR名: ${isCreativeName ? 'Yes' : 'No'}, パース可能: ${isParseable ? 'Yes' : 'No'}`);
      console.log('');
    });

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
