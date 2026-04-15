/**
 * 広告ID 1849185525109761 の詳細確認
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
  console.log('広告ID 1849185525109761 の詳細確認');
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

    const targetAdId = '1849185525109761';
    console.log(`対象広告ID: ${targetAdId}\n`);

    // 全広告を取得
    const adsResponse = await tiktokService.getAds(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );

    const allAds = adsResponse.data?.list || [];
    console.log(`取得した広告総数: ${allAds.length}\n`);

    const targetAd = allAds.find((ad: any) => ad.ad_id === targetAdId);

    if (!targetAd) {
      console.log(`❌ 広告ID ${targetAdId} が見つかりませんでした\n`);

      // "251019" または "堀江" を含む広告を検索
      console.log('参考: "251019" または "堀江" を含む広告:');
      const matching = allAds.filter((ad: any) =>
        ad.ad_name && (ad.ad_name.includes('251019') || ad.ad_name.includes('堀江'))
      );

      if (matching.length > 0) {
        matching.forEach((ad: any, i: number) => {
          console.log(`  [${i + 1}] ID: ${ad.ad_id}, Name: ${ad.ad_name}`);
        });
      } else {
        console.log('  見つかりませんでした');
      }

      await app.close();
      return;
    }

    console.log('✅ 広告が見つかりました！\n');
    console.log('========================================');
    console.log('全フィールドの詳細');
    console.log('========================================\n');

    // 全フィールドをソートして表示
    const sortedKeys = Object.keys(targetAd).sort();
    sortedKeys.forEach(key => {
      const value = targetAd[key];
      if (value === null || value === undefined) {
        console.log(`${key}: [null/undefined]`);
      } else if (typeof value === 'string') {
        console.log(`${key}: "${value}"`);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        console.log(`${key}: ${value}`);
      } else if (Array.isArray(value)) {
        console.log(`${key}: [Array(${value.length})] ${JSON.stringify(value).substring(0, 100)}`);
      } else if (typeof value === 'object') {
        console.log(`${key}: [Object] ${JSON.stringify(value).substring(0, 100)}`);
      }
    });

    console.log('\n========================================');
    console.log('広告名関連フィールド');
    console.log('========================================\n');

    const nameFields = [
      'ad_name',
      'ad_display_name',
      'display_name',
      'name',
      'title',
      'ad_text',
      'card_title',
      'creative_name',
      'adgroup_name',
      'campaign_name'
    ];

    nameFields.forEach(field => {
      if (targetAd[field] !== undefined && targetAd[field] !== null && targetAd[field] !== '') {
        console.log(`${field}: "${targetAd[field]}"`);
      }
    });

    console.log('\n========================================');
    console.log('判定結果');
    console.log('========================================\n');

    const extensions = ['.mp4', '.MP4', '.mov', '.MOV', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG'];
    const isCreativeName = extensions.some(ext => targetAd.ad_name && targetAd.ad_name.includes(ext));
    const parts = targetAd.ad_name ? targetAd.ad_name.split('/') : [];
    const isParseable = parts.length >= 4;

    console.log(`ad_name: "${targetAd.ad_name}"`);
    console.log(`CR名判定: ${isCreativeName ? 'Yes (CR名)' : 'No (手動設定)'}`);
    console.log(`パース可能: ${isParseable ? 'Yes' : 'No'}`);
    console.log(`Campaign Automation Type: ${targetAd.campaign_automation_type || 'N/A'}`);

    if (isParseable && !isCreativeName) {
      console.log('\n✅ この広告名はパース可能な形式です！');
      console.log(`  出稿日: ${parts[0]}`);
      console.log(`  制作者: ${parts[1]}`);
      console.log(`  CR名: ${parts.slice(2, parts.length - 1).join('/')}`);
      console.log(`  LP名: ${parts[parts.length - 1]}`);
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
