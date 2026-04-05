/**
 * AdGroup名で広告を検索
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import axios from 'axios';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const targetAdGroupName = '251119/甲原海人/緊急動画/LP2-CR00072';

  console.log('========================================');
  console.log(`AdGroup名で検索: ${targetAdGroupName}`);
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

    // AdGroup名で完全一致検索
    const exactMatch = allAds.find((ad: any) => ad.adgroup_name === targetAdGroupName);

    if (exactMatch) {
      console.log('🎯 ===== AdGroup名で完全一致！ =====\n');
      console.log(`Ad ID: ${exactMatch.ad_id}`);
      console.log(`Ad Name: ${exactMatch.ad_name}`);
      console.log(`AdGroup ID: ${exactMatch.adgroup_id}`);
      console.log(`AdGroup Name: ${exactMatch.adgroup_name}`);
      console.log(`Operation Status: ${exactMatch.operation_status}`);
      console.log(`Primary Status: ${exactMatch.primary_status || 'N/A'}`);
      console.log(`Campaign ID: ${exactMatch.campaign_id}`);
      console.log(`Campaign Name: ${exactMatch.campaign_name}`);
      console.log(`Create Time: ${exactMatch.create_time || 'N/A'}`);
      console.log(`Modify Time: ${exactMatch.modify_time || 'N/A'}`);

      console.log('\n========================================');
      console.log('全フィールド');
      console.log('========================================\n');

      const sortedKeys = Object.keys(exactMatch).sort();
      sortedKeys.forEach(key => {
        const value = exactMatch[key];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          console.log(`${key}: ${value}`);
        } else if (value === null || value === undefined) {
          console.log(`${key}: [null/undefined]`);
        } else if (Array.isArray(value)) {
          console.log(`${key}: [Array] ${JSON.stringify(value)}`);
        } else if (typeof value === 'object') {
          console.log(`${key}: [Object] ${JSON.stringify(value)}`);
        }
      });

      await app.close();
      return;
    }

    // 部分一致で検索
    console.log('完全一致は見つかりませんでした。部分一致で検索します...\n');

    // 緊急動画で検索
    const partialMatches = allAds.filter((ad: any) =>
      ad.adgroup_name && ad.adgroup_name.includes('緊急動画')
    );

    if (partialMatches.length > 0) {
      console.log(`AdGroup名に「緊急動画」を含む広告: ${partialMatches.length}件\n`);

      partialMatches.forEach((ad: any, index: number) => {
        console.log(`[${index + 1}] Ad ID: ${ad.ad_id}`);
        console.log(`    Ad Name: ${ad.ad_name}`);
        console.log(`    AdGroup Name: ${ad.adgroup_name}`);
        console.log(`    Status: ${ad.operation_status}`);
        console.log(`    Campaign: ${ad.campaign_name}`);
        console.log('');
      });
    } else {
      console.log('❌ AdGroup名に「緊急動画」を含む広告は見つかりませんでした\n');
    }

    // キャンペーン名で検索
    console.log('キャンペーン名でも検索してみます...\n');

    const campaignMatches = allAds.filter((ad: any) =>
      ad.campaign_name && ad.campaign_name.includes('緊急動画')
    );

    if (campaignMatches.length > 0) {
      console.log(`キャンペーン名に「緊急動画」を含む広告: ${campaignMatches.length}件\n`);

      campaignMatches.forEach((ad: any, index: number) => {
        console.log(`[${index + 1}] Ad ID: ${ad.ad_id}`);
        console.log(`    Ad Name: ${ad.ad_name}`);
        console.log(`    AdGroup Name: ${ad.adgroup_name}`);
        console.log(`    Campaign Name: ${ad.campaign_name}`);
        console.log(`    Status: ${ad.operation_status}`);
        console.log('');
      });
    } else {
      console.log('❌ キャンペーン名に「緊急動画」を含む広告は見つかりませんでした\n');
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
