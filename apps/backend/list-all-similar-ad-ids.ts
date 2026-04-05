/**
 * AI3アカウントの全広告から184918で始まるIDを抽出
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import axios from 'axios';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const targetAdId = '1849185525109761';
  const prefix = '184918';

  console.log('========================================');
  console.log(`AI3アカウントの全広告から ${prefix} で始まるIDを抽出`);
  console.log(`対象ID: ${targetAdId}`);
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

    // ページネーション対応で全広告を取得
    console.log('全広告を取得中...\n');
    let allAds: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
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

      const ads = response.data.data?.list || [];
      allAds = allAds.concat(ads);

      const pageInfo = response.data.data?.page_info;
      hasMore = pageInfo?.page < pageInfo?.total_page;

      console.log(`  ページ${page}を取得: ${ads.length}件`);

      if (hasMore) {
        page++;
      }
    }

    console.log(`\n✓ 広告総数: ${allAds.length}\n`);

    // 対象IDを検索
    const exactMatch = allAds.find((ad: any) => ad.ad_id === targetAdId);
    if (exactMatch) {
      console.log(`🎯 対象ID ${targetAdId} が見つかりました！`);
      console.log(`Ad Name: ${exactMatch.ad_name}`);
      console.log(`Status: ${exactMatch.operation_status}\n`);
    } else {
      console.log(`❌ 対象ID ${targetAdId} は見つかりませんでした\n`);
    }

    // 184918で始まるIDを抽出
    const similarAds = allAds.filter((ad: any) =>
      String(ad.ad_id).startsWith(prefix)
    );

    console.log('========================================');
    console.log(`${prefix} で始まるID: ${similarAds.length}件`);
    console.log('========================================\n');

    if (similarAds.length > 0) {
      // IDでソート
      similarAds.sort((a: any, b: any) => {
        return String(a.ad_id).localeCompare(String(b.ad_id));
      });

      // 全て表示
      similarAds.forEach((ad: any, index: number) => {
        const isTarget = ad.ad_id === targetAdId ? ' ← 対象ID' : '';
        console.log(`[${index + 1}] ${ad.ad_id}${isTarget}`);
        console.log(`    Name: ${ad.ad_name}`);
        console.log(`    Status: ${ad.operation_status}`);
        console.log(`    Campaign: ${ad.campaign_name}`);
        console.log('');
      });

      // 対象IDに最も近いIDを探す
      console.log('========================================');
      console.log('対象IDに最も近いIDを分析');
      console.log('========================================\n');

      const targetNum = BigInt(targetAdId);
      const differences = similarAds.map((ad: any) => {
        const adNum = BigInt(ad.ad_id);
        const diff = adNum > targetNum ? adNum - targetNum : targetNum - adNum;
        return {
          ad_id: ad.ad_id,
          ad_name: ad.ad_name,
          difference: Number(diff),
        };
      });

      differences.sort((a, b) => a.difference - b.difference);

      console.log('最も近い上位5件:');
      differences.slice(0, 5).forEach((item, index) => {
        console.log(`[${index + 1}] ${item.ad_id}`);
        console.log(`    差分: ${item.difference}`);
        console.log(`    Name: ${item.ad_name}`);
        console.log('');
      });
    }

    console.log('========================================');
    console.log('考察');
    console.log('========================================\n');

    if (!exactMatch) {
      console.log('広告ID 1849185525109761 がAPIで取得できない理由:');
      console.log('');
      console.log('1. 管理画面で表示されているIDが間違っている可能性');
      console.log('   → 管理画面のスクリーンショットを再確認してください');
      console.log('');
      console.log('2. 別のAdvertiserアカウントに属している可能性');
      console.log('   → 他のアカウントも確認してみてください');
      console.log('');
      console.log('3. IDの一部が切れている、または見間違えている可能性');
      console.log(`   → ${prefix}で始まる類似IDを上記で確認してください`);
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
