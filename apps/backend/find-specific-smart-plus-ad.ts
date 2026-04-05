import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import axios from 'axios';

/**
 * 特定の広告IDを検索（ad_idまたはsmart_plus_ad_idとして）
 */
async function findSpecificAd() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const advertiserId = '7543540647266074641'; // AI_3
  const targetAdId = '1849212350625266'; // 検索する広告ID

  console.log('========================================');
  console.log('特定広告ID検索');
  console.log('========================================');
  console.log(`Advertiser ID: ${advertiserId}`);
  console.log(`Target Ad ID: ${targetAdId}\n`);

  // アクセストークンを取得
  const token = await prisma.oAuthToken.findFirst({
    where: {
      advertiserId,
      expiresAt: { gt: new Date() },
    },
  });

  if (!token) {
    console.log('❌ 有効なトークンが見つかりませんでした');
    await app.close();
    return;
  }

  const baseUrl = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com';

  // パターン1: smart_plus_ad_id として検索
  console.log('----------------------------------------');
  console.log('パターン1: smart_plus_ad_id として検索');
  console.log('----------------------------------------\n');

  try {
    const response1 = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
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

    const ads = response1.data.data?.list || [];
    if (ads.length > 0) {
      console.log('✓ 見つかりました！（smart_plus_ad_idとして）\n');
      const ad = ads[0];
      console.log('【広告情報】');
      console.log(`広告名: ${ad.ad_name}`);
      console.log(`Smart Plus Ad ID: ${ad.smart_plus_ad_id}`);
      console.log(`Ad ID: ${ad.ad_id}`);
      console.log(`Campaign ID: ${ad.campaign_id}`);
      console.log(`AdGroup ID: ${ad.adgroup_id}`);
      console.log(`Status: ${ad.operation_status}`);
      console.log(`Campaign Name: ${ad.campaign_name}`);
      console.log(`AdGroup Name: ${ad.adgroup_name}`);

      await app.close();
      return;
    } else {
      console.log('❌ smart_plus_ad_idとしては見つかりませんでした\n');
    }
  } catch (error: any) {
    console.log('❌ エラー:', error.response?.data || error.message);
    console.log('\n');
  }

  // パターン2: ad_id として検索（全広告を取得して検索）
  console.log('----------------------------------------');
  console.log('パターン2: ad_id として検索（全広告を取得）');
  console.log('----------------------------------------\n');

  try {
    let found = false;
    let currentPage = 1;
    const pageSize = 100;

    while (!found && currentPage <= 10) {
      // 最大10ページまで検索
      console.log(`ページ ${currentPage} を検索中...`);

      const response = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
        headers: {
          'Access-Token': token.accessToken,
          'Content-Type': 'application/json',
        },
        params: {
          advertiser_id: advertiserId,
          page: currentPage,
          page_size: pageSize,
        },
      });

      const ads = response.data.data?.list || [];

      // ad_idで検索
      const foundAd = ads.find((ad: any) => ad.ad_id === targetAdId);

      if (foundAd) {
        console.log('\n✓ 見つかりました！（ad_idとして）\n');
        console.log('【広告情報】');
        console.log(`広告名: ${foundAd.ad_name}`);
        console.log(`Smart Plus Ad ID: ${foundAd.smart_plus_ad_id || '(なし)'}`);
        console.log(`Ad ID: ${foundAd.ad_id}`);
        console.log(`Campaign ID: ${foundAd.campaign_id}`);
        console.log(`AdGroup ID: ${foundAd.adgroup_id}`);
        console.log(`Status: ${foundAd.operation_status}`);
        console.log(`Campaign Name: ${foundAd.campaign_name}`);
        console.log(`AdGroup Name: ${foundAd.adgroup_name}`);
        found = true;
        break;
      }

      // 次のページへ
      const totalPages = Math.ceil((response.data.data?.page_info?.total_number || 0) / pageSize);
      if (currentPage >= totalPages) {
        break;
      }
      currentPage++;
    }

    if (!found) {
      console.log('\n❌ ad_idとしても見つかりませんでした');
      console.log('この広告IDは存在しないか、別のアカウントに属している可能性があります');
    }
  } catch (error: any) {
    console.log('❌ エラー:', error.response?.data || error.message);
  }

  await app.close();
}

findSpecificAd();
