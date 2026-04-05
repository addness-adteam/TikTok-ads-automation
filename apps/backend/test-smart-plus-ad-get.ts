import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import axios from 'axios';

/**
 * /smart_plus/ad/get/ エンドポイントをテスト
 */
async function testSmartPlusAdGet() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const advertiserId = '7543540647266074641'; // AI_3
  const targetAdId = '1849212350625266';

  console.log('========================================');
  console.log('/smart_plus/ad/get/ エンドポイントをテスト');
  console.log('========================================\n');

  const token = await prisma.oAuthToken.findFirst({
    where: {
      advertiserId,
      expiresAt: { gt: new Date() },
    },
  });

  if (!token) {
    console.log('❌ トークンなし');
    await app.close();
    return;
  }

  const baseUrl = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com';

  // パターン1: /v1.3/smart_plus/ad/get/ で smart_plus_ad_id を指定
  console.log('パターン1: /v1.3/smart_plus/ad/get/ で filtering に smart_plus_ad_ids を指定');
  console.log('----------------------------------------\n');

  try {
    const response = await axios.get(`${baseUrl}/v1.3/smart_plus/ad/get/`, {
      headers: {
        'Access-Token': token.accessToken,
        'Content-Type': 'application/json',
      },
      params: {
        advertiser_id: advertiserId,
        filtering: JSON.stringify({
          smart_plus_ad_ids: [targetAdId],
        }),
      },
    });

    console.log('✓ リクエスト成功！\n');
    console.log('レスポンス:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.log('❌ エラー');
    if (error.response) {
      console.log(`ステータス: ${error.response.status}`);
      console.log(`メッセージ: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.log(`エラー: ${error.message}`);
    }
  }

  console.log('\n');

  // パターン2: /v1.3/smart_plus/ad/get/ でフィルタなし（全広告取得）
  console.log('パターン2: /v1.3/smart_plus/ad/get/ でフィルタなし（最初の10件）');
  console.log('----------------------------------------\n');

  try {
    const response = await axios.get(`${baseUrl}/v1.3/smart_plus/ad/get/`, {
      headers: {
        'Access-Token': token.accessToken,
        'Content-Type': 'application/json',
      },
      params: {
        advertiser_id: advertiserId,
        page_size: 10,
      },
    });

    console.log('✓ リクエスト成功！\n');
    const ads = response.data.data?.list || [];
    console.log(`取得された広告数: ${ads.length}\n`);

    if (ads.length > 0) {
      console.log('広告リスト:');
      ads.slice(0, 5).forEach((ad: any, index: number) => {
        console.log(`\n[${index + 1}]`);
        console.log(`  広告名: ${ad.ad_name || '(なし)'}`);
        console.log(`  Smart Plus Ad ID: ${ad.smart_plus_ad_id || '(なし)'}`);
        console.log(`  Ad ID: ${ad.ad_id || '(なし)'}`);
        console.log(`  Status: ${ad.operation_status || '(なし)'}`);
      });
    }
  } catch (error: any) {
    console.log('❌ エラー');
    if (error.response) {
      console.log(`ステータス: ${error.response.status}`);
      console.log(`メッセージ: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.log(`エラー: ${error.message}`);
    }
  }

  await app.close();
}

testSmartPlusAdGet();
