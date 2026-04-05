/**
 * 特定の広告IDを直接APIで取得してみる
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import axios from 'axios';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const targetAdId = '1849185525109761';

  console.log('========================================');
  console.log(`広告ID ${targetAdId} を直接APIで取得`);
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

    // 方法1: ad_idsフィルタで直接指定
    console.log('[方法1] ad_idsフィルタで直接取得を試みる\n');
    try {
      const response1 = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
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

      console.log('✓ APIレスポンス成功');
      console.log(`ステータスコード: ${response1.status}`);
      console.log(`レスポンスコード: ${response1.data.code}`);
      console.log(`メッセージ: ${response1.data.message}`);

      const ads = response1.data.data?.list || [];
      console.log(`取得された広告数: ${ads.length}\n`);

      if (ads.length > 0) {
        console.log('🎯 広告が見つかりました！\n');
        const ad = ads[0];
        console.log(`Ad ID: ${ad.ad_id}`);
        console.log(`Ad Name: ${ad.ad_name}`);
        console.log(`Operation Status: ${ad.operation_status}`);
        console.log(`Campaign ID: ${ad.campaign_id}`);
        console.log(`Campaign Name: ${ad.campaign_name}`);
      } else {
        console.log('❌ ad_idsフィルタで指定しても広告が見つかりませんでした\n');
      }
    } catch (error: any) {
      console.log('❌ APIエラー');
      console.log(`ステータスコード: ${error.response?.status}`);
      console.log(`エラーメッセージ: ${error.response?.data?.message || error.message}`);
      console.log(`詳細: ${JSON.stringify(error.response?.data, null, 2)}\n`);
    }

    // 方法2: 最初の100件を取得して、実際のad_idの形式を確認
    console.log('\n[方法2] 最初の100件の広告を取得して、ad_idの形式を確認\n');
    try {
      const response2 = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
        headers: {
          'Access-Token': token.accessToken,
          'Content-Type': 'application/json',
        },
        params: {
          advertiser_id: advertiser.tiktokAdvertiserId,
          page_size: 100,
          page: 1,
        },
      });

      const ads = response2.data.data?.list || [];
      console.log(`取得された広告数: ${ads.length}\n`);

      if (ads.length > 0) {
        console.log('最初の5件のad_idとad_name:');
        ads.slice(0, 5).forEach((ad: any, index: number) => {
          console.log(`  [${index + 1}] ${ad.ad_id} (${typeof ad.ad_id}) - ${ad.ad_name}`);
        });

        // ad_idが数値型の可能性もあるので、両方でチェック
        console.log(`\n対象ID "${targetAdId}" (文字列型) で検索:`);
        const foundStr = ads.find((ad: any) => ad.ad_id === targetAdId);
        console.log(foundStr ? '  ✓ 見つかりました' : '  ✗ 見つかりませんでした');

        console.log(`\n対象ID ${targetAdId} (数値型) で検索:`);
        const foundNum = ads.find((ad: any) => ad.ad_id == targetAdId); // == で型変換を許可
        console.log(foundNum ? '  ✓ 見つかりました' : '  ✗ 見つかりませんでした');

        // 類似したIDがあるかチェック
        console.log(`\n類似したIDがあるかチェック（前方一致）:`);
        const similar = ads.filter((ad: any) =>
          String(ad.ad_id).startsWith('184918552')
        );
        if (similar.length > 0) {
          console.log(`  見つかった類似ID: ${similar.length}件`);
          similar.forEach((ad: any) => {
            console.log(`    - ${ad.ad_id} - ${ad.ad_name}`);
          });
        } else {
          console.log('  類似したIDは見つかりませんでした');
        }
      }
    } catch (error: any) {
      console.log('❌ APIエラー');
      console.log(`エラーメッセージ: ${error.response?.data?.message || error.message}\n`);
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
