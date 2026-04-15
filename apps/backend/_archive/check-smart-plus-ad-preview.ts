import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import axios from 'axios';

/**
 * スマートプラス広告プレビューAPIをテスト
 * /smart_plus/ad/preview/ エンドポイントで広告名を取得
 */
async function checkSmartPlusAdPreview() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const advertiserId = '7543540647266074641'; // AI_3
  const adId = '1849212350625266'; // チェックする広告ID

  console.log('========================================');
  console.log('スマートプラス広告プレビューAPIテスト');
  console.log('========================================');
  console.log(`Advertiser ID: ${advertiserId}`);
  console.log(`Ad ID: ${adId}\n`);

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

  console.log('✓ アクセストークン取得成功\n');

  // TikTok API設定
  const baseUrl = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com';

  // 試すエンドポイントとパラメータのパターン
  const testPatterns = [
    {
      endpoint: '/v1.3/ad/get/',
      params: {
        advertiser_id: advertiserId,
        filtering: JSON.stringify({
          smart_plus_ad_ids: [adId],
        }),
      },
      description: 'ad/get with smart_plus_ad_ids in filtering',
    },
    {
      endpoint: '/v1.3/ad/get/',
      params: {
        advertiser_id: advertiserId,
        smart_plus_ad_id: adId,
      },
      description: 'ad/get with smart_plus_ad_id parameter',
    },
    {
      endpoint: '/v1.3/smart_plus/ad/get/',
      params: {
        advertiser_id: advertiserId,
        ad_id: adId,
      },
      description: 'smart_plus/ad/get with ad_id',
    },
    {
      endpoint: '/v1.3/smart_plus/ad/get/',
      params: {
        advertiser_id: advertiserId,
        smart_plus_ad_id: adId,
      },
      description: 'smart_plus/ad/get with smart_plus_ad_id',
    },
  ];

  for (const pattern of testPatterns) {
    console.log(`----------------------------------------`);
    console.log(`テスト: ${pattern.description}`);
    console.log(`エンドポイント: ${pattern.endpoint}`);
    console.log(`パラメータ: ${JSON.stringify(pattern.params, null, 2)}`);
    console.log(`----------------------------------------`);

    try {
      const response = await axios.get(`${baseUrl}${pattern.endpoint}`, {
        headers: {
          'Access-Token': token.accessToken,
          'Content-Type': 'application/json',
        },
        params: pattern.params,
      });

      console.log('✓ リクエスト成功！');
      console.log('\nレスポンス:');
      console.log(JSON.stringify(response.data, null, 2));
      console.log('\n');

      // 成功したらここで終了
      if (response.data.data?.list && response.data.data.list.length > 0) {
        console.log('========================================');
        console.log('広告が見つかりました！');
        console.log('========================================');
        const ad = response.data.data.list[0];
        console.log(`広告名: ${ad.ad_name || '(名前なし)'}`);
        await app.close();
        return;
      }
    } catch (error: any) {
      console.log('❌ リクエスト失敗');
      if (error.response) {
        console.log(`ステータスコード: ${error.response.status}`);
        console.log(`エラーメッセージ: ${JSON.stringify(error.response.data, null, 2)}`);
      } else {
        console.log(`エラー: ${error.message}`);
      }
      console.log('\n');
    }
  }

  // 通常の ad/get エンドポイントでも確認
  console.log('========================================');
  console.log('通常のad/getエンドポイントでも確認');
  console.log('========================================\n');

  try {
    const response = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
      headers: {
        'Access-Token': token.accessToken,
        'Content-Type': 'application/json',
      },
      params: {
        advertiser_id: advertiserId,
        filtering: JSON.stringify({
          ad_ids: [adId],
        }),
      },
    });

    console.log('✓ ad/get リクエスト成功！');
    const ads = response.data.data?.list || [];

    if (ads.length > 0) {
      const ad = ads[0];
      console.log('\n広告情報:');
      console.log(`広告ID: ${ad.ad_id}`);
      console.log(`広告名: ${ad.ad_name || '(名前なし)'}`);
      console.log(`AdGroup ID: ${ad.adgroup_id}`);
      console.log(`Campaign ID: ${ad.campaign_id}`);
      console.log(`ステータス: ${ad.operation_status}`);
      console.log(`広告フォーマット: ${ad.ad_format}`);
      console.log('\nクリエイティブ情報:');
      console.log(JSON.stringify(ad.creatives, null, 2));
    } else {
      console.log('❌ 広告が見つかりませんでした');
    }
  } catch (error: any) {
    console.log('❌ ad/get リクエスト失敗');
    if (error.response) {
      console.log(`ステータスコード: ${error.response.status}`);
      console.log(`エラーメッセージ: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.log(`エラー: ${error.message}`);
    }
  }

  await app.close();
}

checkSmartPlusAdPreview();
