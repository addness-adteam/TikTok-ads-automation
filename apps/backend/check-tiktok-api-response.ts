/**
 * TikTok APIの生のレスポンスを確認するスクリプト
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
  console.log('TikTok API レスポンスの詳細確認');
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

    // 最初の広告のフル構造を出力
    if (allAds.length > 0) {
      const firstAd = allAds[0];

      console.log('========================================');
      console.log('最初の広告のフルレスポンス');
      console.log('========================================\n');
      console.log(JSON.stringify(firstAd, null, 2));

      console.log('\n========================================');
      console.log('利用可能なフィールド一覧');
      console.log('========================================\n');

      const keys = Object.keys(firstAd);
      keys.forEach(key => {
        const value = firstAd[key];
        const type = typeof value;
        const preview = type === 'string' ? value.substring(0, 50) :
                       type === 'object' ? JSON.stringify(value).substring(0, 50) :
                       value;
        console.log(`  ${key}: (${type}) ${preview}`);
      });

      console.log('\n========================================');
      console.log('広告名関連のフィールドを確認');
      console.log('========================================\n');

      // 広告名に関連しそうなフィールドを全て確認
      const nameFields = [
        'ad_name',
        'ad_title',
        'name',
        'title',
        'display_name',
        'creative_name',
        'ad_text',
        'identity_id',
        'identity_name'
      ];

      nameFields.forEach(field => {
        if (firstAd[field] !== undefined) {
          console.log(`  ${field}: ${firstAd[field]}`);
        }
      });

      // video/image情報も確認
      console.log('\n========================================');
      console.log('クリエイティブ情報');
      console.log('========================================\n');

      if (firstAd.video_id) {
        console.log(`  video_id: ${firstAd.video_id}`);
      }
      if (firstAd.image_ids) {
        console.log(`  image_ids: ${firstAd.image_ids}`);
      }
      if (firstAd.creatives) {
        console.log(`  creatives: ${JSON.stringify(firstAd.creatives, null, 2)}`);
      }
    }

    // 新スマプラキャンペーンの広告も確認
    console.log('\n========================================');
    console.log('キャンペーン 251117/AI/天才Ver2/LP1-CR00656～CR00660 の広告');
    console.log('========================================\n');

    const targetCampaignId = '1849008461509889';
    const targetAds = allAds.filter((ad: any) =>
      ad.campaign_id === targetCampaignId && ad.operation_status === 'ENABLE'
    );

    if (targetAds.length > 0) {
      const targetAd = targetAds[0];
      console.log('最初の広告の主要フィールド:\n');
      console.log(`  ad_id: ${targetAd.ad_id}`);
      console.log(`  campaign_id: ${targetAd.campaign_id}`);
      console.log(`  ad_name: ${targetAd.ad_name}`);

      // 全フィールドを確認
      console.log('\n全フィールド:\n');
      Object.keys(targetAd).sort().forEach(key => {
        const value = targetAd[key];
        if (typeof value === 'string' || typeof value === 'number') {
          console.log(`  ${key}: ${value}`);
        } else if (typeof value === 'object') {
          console.log(`  ${key}: ${JSON.stringify(value)}`);
        } else {
          console.log(`  ${key}: ${value}`);
        }
      });
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
