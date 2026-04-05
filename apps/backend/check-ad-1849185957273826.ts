/**
 * 広告ID 1849185957273826 の全フィールドを詳細確認
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import axios from 'axios';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const targetAdId = '1849185957273826';

  console.log('========================================');
  console.log(`広告ID ${targetAdId} の全フィールドを確認`);
  console.log('========================================\n');

  try {
    // AI3アカウントを取得
    const advertiser = await prisma.advertiser.findFirst({
      where: {
        OR: [
          { name: { contains: 'AI_3' } },
          { name: { contains: 'ai_3' } },
        ]
      }
    });

    if (!advertiser) {
      console.log('❌ AI_3という名前のAdvertiserが見つかりませんでした');
      await app.close();
      return;
    }

    console.log(`✓ AI3アカウント: ${advertiser.name}`);
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

    const baseUrl = process.env.TIKTOK_API_BASE_URL || '';

    // ad_idsフィルタで直接取得
    const response = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
      headers: {
        'Access-Token': token.accessToken,
        'Content-Type': 'application/json',
      },
      params: {
        advertiser_id: advertiser.tiktokAdvertiserId,
        filtering: JSON.stringify({
          ad_ids: [targetAdId],
        }),
      },
    });

    const ads = response.data.data?.list || [];

    if (ads.length === 0) {
      console.log('❌ 広告が見つかりませんでした');
      await app.close();
      return;
    }

    const ad = ads[0];

    console.log('✓ 広告が見つかりました\n');
    console.log('========================================');
    console.log('基本情報');
    console.log('========================================\n');
    console.log(`Ad ID: ${ad.ad_id}`);
    console.log(`Ad Name: ${ad.ad_name}`);
    console.log(`Operation Status: ${ad.operation_status}`);
    console.log(`Campaign ID: ${ad.campaign_id}`);
    console.log(`Campaign Name: ${ad.campaign_name}`);
    console.log(`AdGroup ID: ${ad.adgroup_id}`);
    console.log(`AdGroup Name: ${ad.adgroup_name}`);

    console.log('\n========================================');
    console.log('クリエイティブ関連のID');
    console.log('========================================\n');

    // クリエイティブ関連のフィールドを探す
    const creativeFields = [
      'creative_id',
      'video_id',
      'image_ids',
      'creative_authorized',
      'creative_material_mode',
      'ad_format',
      'creative_type',
      'item_id',
      'spark_ad_id',
    ];

    creativeFields.forEach(field => {
      if (ad[field] !== undefined && ad[field] !== null) {
        console.log(`${field}: ${JSON.stringify(ad[field])}`);
      }
    });

    console.log('\n========================================');
    console.log('全フィールド（アルファベット順）');
    console.log('========================================\n');

    const sortedKeys = Object.keys(ad).sort();
    sortedKeys.forEach(key => {
      const value = ad[key];
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

    // 元の広告ID 1849185525109761 で検索
    console.log('\n========================================');
    console.log('元の広告ID 1849185525109761 で検索');
    console.log('========================================\n');

    const originalAdId = '1849185525109761';

    // クリエイティブIDとして検索してみる
    console.log(`クリエイティブIDフィールドに ${originalAdId} があるか確認中...\n`);

    // 全広告を取得してクリエイティブIDをチェック
    let allAds: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const adsResponse = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
        headers: {
          'Access-Token': token.accessToken,
          'Content-Type': 'application/json',
        },
        params: {
          advertiser_id: advertiser.tiktokAdvertiserId,
          page_size: 100,
          page: page,
        },
      });

      const pageAds = adsResponse.data.data?.list || [];
      allAds = allAds.concat(pageAds);

      const pageInfo = adsResponse.data.data?.page_info;
      hasMore = pageInfo?.page < pageInfo?.total_page;

      if (hasMore) {
        page++;
      }
    }

    // クリエイティブIDで検索
    const foundByCreativeId = allAds.find((a: any) => {
      return a.creative_id === originalAdId ||
             a.video_id === originalAdId ||
             (a.image_ids && a.image_ids.includes(originalAdId)) ||
             (a.item_id === originalAdId) ||
             (a.spark_ad_id === originalAdId);
    });

    if (foundByCreativeId) {
      console.log('🎯 クリエイティブIDで見つかりました！\n');
      console.log(`実際の Ad ID: ${foundByCreativeId.ad_id}`);
      console.log(`Ad Name: ${foundByCreativeId.ad_name}`);
      console.log(`Creative ID: ${foundByCreativeId.creative_id || 'N/A'}`);
      console.log(`Video ID: ${foundByCreativeId.video_id || 'N/A'}`);
      console.log(`Image IDs: ${foundByCreativeId.image_ids || 'N/A'}`);
      console.log(`Item ID: ${foundByCreativeId.item_id || 'N/A'}`);
      console.log(`Spark Ad ID: ${foundByCreativeId.spark_ad_id || 'N/A'}`);
    } else {
      console.log(`❌ クリエイティブIDとしても ${originalAdId} は見つかりませんでした`);
    }

  } catch (error: any) {
    console.error('\n❌ エラーが発生しました:');
    console.error(error.message);
    if (error.response?.data) {
      console.error('API Response:', JSON.stringify(error.response.data, null, 2));
    }
  } finally {
    await app.close();
  }
}

bootstrap();
