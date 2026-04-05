/**
 * 特定の広告IDの全フィールドを確認
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
  console.log('特定広告の詳細フィールド確認');
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

    // スクリーンショットの広告IDを確認
    const targetAdId = '1849185523208849';
    console.log(`対象広告ID: ${targetAdId}\n`);

    // 全広告を取得
    const adsResponse = await tiktokService.getAds(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );

    const allAds = adsResponse.data?.list || [];
    const targetAd = allAds.find((ad: any) => ad.ad_id === targetAdId);

    if (!targetAd) {
      console.log(`❌ 広告ID ${targetAdId} が見つかりませんでした`);
      console.log('\n利用可能な広告ID（最初の10件）:');
      allAds.slice(0, 10).forEach((ad: any, i: number) => {
        console.log(`  [${i + 1}] ${ad.ad_id}: ${ad.ad_name}`);
      });
      await app.close();
      return;
    }

    console.log('✓ 広告が見つかりました\n');
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
        console.log(`${key}: [Array(${value.length})] ${JSON.stringify(value)}`);
      } else if (typeof value === 'object') {
        console.log(`${key}: [Object] ${JSON.stringify(value, null, 2)}`);
      } else {
        console.log(`${key}: ${value}`);
      }
    });

    console.log('\n========================================');
    console.log('広告名関連フィールドの抽出');
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
      'identity_name',
      'page_name',
      'adgroup_name',
      'campaign_name'
    ];

    nameFields.forEach(field => {
      if (targetAd[field] !== undefined && targetAd[field] !== null && targetAd[field] !== '') {
        console.log(`  ${field}: "${targetAd[field]}"`);
      }
    });

    console.log('\n========================================');
    console.log('この広告のキャンペーン情報');
    console.log('========================================\n');

    console.log(`Campaign ID: ${targetAd.campaign_id}`);
    console.log(`Campaign Name: ${targetAd.campaign_name}`);
    console.log(`Campaign Automation Type: ${targetAd.campaign_automation_type || 'N/A'}`);
    console.log(`AdGroup ID: ${targetAd.adgroup_id}`);
    console.log(`AdGroup Name: ${targetAd.adgroup_name}`);

    // キャンペーン詳細を取得
    const campaignsResponse = await tiktokService.getCampaigns(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );
    const campaigns = campaignsResponse.data?.list || [];
    const campaign = campaigns.find((c: any) => c.campaign_id === targetAd.campaign_id);

    if (campaign) {
      console.log('\nキャンペーンの詳細フィールド:');
      console.log(`  campaign_automation_type: ${campaign.campaign_automation_type}`);
      console.log(`  is_smart_performance_campaign: ${campaign.is_smart_performance_campaign}`);
      console.log(`  objective_type: ${campaign.objective_type}`);
    }

    console.log('\n========================================');
    console.log('判定結果');
    console.log('========================================\n');

    const extensions = ['.mp4', '.MP4', '.mov', '.MOV', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG'];
    const isCreativeName = extensions.some(ext => targetAd.ad_name && targetAd.ad_name.includes(ext));
    const parts = targetAd.ad_name ? targetAd.ad_name.split('/') : [];
    const isParseable = parts.length >= 4;

    console.log(`ad_name: "${targetAd.ad_name}"`);
    console.log(`CR名判定: ${isCreativeName ? 'Yes' : 'No'}`);
    console.log(`パース可能: ${isParseable ? 'Yes' : 'No'}`);

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
