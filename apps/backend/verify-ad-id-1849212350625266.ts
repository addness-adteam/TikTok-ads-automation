import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import axios from 'axios';

/**
 * 広告ID 1849212350625266 を正確に確認
 */
async function verifyAdId() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const advertiserId = '7543540647266074641'; // AI_3
  const targetAdId = '1849212350625266';

  console.log('========================================');
  console.log('広告ID確認');
  console.log('========================================');
  console.log(`Target Ad ID: ${targetAdId}\n`);

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

  // smart_plus_ad_idsでフィルタリング
  console.log('smart_plus_ad_idsでフィルタリング...\n');

  try {
    const response = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
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

    console.log('APIレスポンス:');
    console.log(JSON.stringify(response.data, null, 2));

    const ads = response.data.data?.list || [];
    console.log(`\n取得された広告数: ${ads.length}\n`);

    if (ads.length > 0) {
      console.log('取得された広告のIDをチェック:');
      ads.forEach((ad: any, index: number) => {
        console.log(`\n[${index + 1}]`);
        console.log(`  Smart Plus Ad ID: ${ad.smart_plus_ad_id}`);
        console.log(`  Ad ID: ${ad.ad_id}`);
        console.log(`  広告名: ${ad.ad_name}`);
        console.log(`  検索IDと一致?: ${ad.smart_plus_ad_id === targetAdId || ad.ad_id === targetAdId ? 'はい' : 'いいえ'}`);
      });
    }
  } catch (error: any) {
    console.log('❌ エラー:', error.response?.data || error.message);
  }

  await app.close();
}

verifyAdId();
