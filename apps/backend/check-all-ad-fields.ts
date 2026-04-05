/**
 * 広告ID 1849185957273826 の全フィールドを完全表示
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import axios from 'axios';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const targetAdId = '1849185957273826';

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

    console.log('========================================');
    console.log('広告の全フィールド（完全版）');
    console.log('========================================\n');

    // 全フィールドを表示（オブジェクト型も完全に）
    console.log(JSON.stringify(ad, null, 2));

    console.log('\n========================================');
    console.log('広告名関連のフィールドを抽出');
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
      'smart_creative_name',
      'custom_name',
    ];

    nameFields.forEach(field => {
      if (ad[field] !== undefined && ad[field] !== null && ad[field] !== '') {
        console.log(`${field}: "${ad[field]}"`);
      }
    });

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
