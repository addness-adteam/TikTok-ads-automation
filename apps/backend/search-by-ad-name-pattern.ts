/**
 * 広告名パターンで検索（スクリーンショットの広告名を探す）
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import axios from 'axios';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  console.log('========================================');
  console.log('広告名パターンで検索');
  console.log('========================================\n');
  console.log('対象パターン:');
  console.log('  - "251019" を含む');
  console.log('  - "堀江" を含む');
  console.log('  - "中途CB" を含む');
  console.log('');

  try {
    const advertisers = await prisma.advertiser.findMany({
      include: {
        appeal: true
      }
    });

    const baseUrl = process.env.TIKTOK_API_BASE_URL || '';
    const matchingAds: any[] = [];

    for (const advertiser of advertisers) {
      console.log(`\n検索中: [${advertiser.name}]`);

      // アクセストークンを取得
      const token = await prisma.oAuthToken.findFirst({
        where: {
          advertiserId: advertiser.tiktokAdvertiserId,
          expiresAt: { gt: new Date() }
        }
      });

      if (!token) {
        console.log('  ⚠️  有効なトークンなし - スキップ');
        continue;
      }

      try {
        // ページネーション対応で全広告を取得
        let allAds: any[] = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
          const params: any = {
            advertiser_id: advertiser.tiktokAdvertiserId,
            page_size: 100,
            page: page,
          };

          const response = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
            headers: {
              'Access-Token': token.accessToken,
              'Content-Type': 'application/json',
            },
            params,
          });

          const ads = response.data.data?.list || [];
          allAds = allAds.concat(ads);

          const pageInfo = response.data.data?.page_info;
          hasMore = pageInfo?.page < pageInfo?.total_page;

          if (hasMore) {
            page++;
          }
        }

        console.log(`  ✓ 広告総数: ${allAds.length}`);

        // パターンマッチング
        const matches = allAds.filter((ad: any) => {
          const adName = ad.ad_name || '';
          return adName.includes('251019') ||
                 adName.includes('堀江') ||
                 adName.includes('中途CB');
        });

        if (matches.length > 0) {
          console.log(`  🎯 マッチ: ${matches.length}件`);
          matches.forEach((ad: any) => {
            matchingAds.push({
              advertiser: advertiser.name,
              advertiserId: advertiser.tiktokAdvertiserId,
              ad: ad
            });
          });
        }

      } catch (error: any) {
        console.log(`  ❌ エラー: ${error.message}`);
      }
    }

    console.log('\n========================================');
    console.log('検索結果');
    console.log('========================================\n');

    if (matchingAds.length === 0) {
      console.log('❌ マッチする広告が見つかりませんでした');
    } else {
      console.log(`✅ ${matchingAds.length}件の広告が見つかりました\n`);

      matchingAds.forEach((item, i) => {
        const ad = item.ad;
        console.log(`\n[${i + 1}] ${ad.ad_name}`);
        console.log(`    Advertiser: ${item.advertiser}`);
        console.log(`    Advertiser ID: ${item.advertiserId}`);
        console.log(`    Ad ID: ${ad.ad_id}`);
        console.log(`    Status: ${ad.operation_status}`);
        console.log(`    Campaign: ${ad.campaign_name}`);
        console.log(`    Campaign Automation Type: ${ad.campaign_automation_type || 'N/A'}`);

        // 判定
        const extensions = ['.mp4', '.MP4', '.mov', '.MOV', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG'];
        const isCreativeName = extensions.some(ext => ad.ad_name && ad.ad_name.includes(ext));
        const parts = ad.ad_name ? ad.ad_name.split('/') : [];
        const isParseable = parts.length >= 4;

        console.log(`    CR名判定: ${isCreativeName ? 'Yes (CR名)' : 'No (手動設定)'}`);
        console.log(`    パース可能: ${isParseable ? 'Yes' : 'No'}`);

        if (isParseable && !isCreativeName) {
          console.log(`    出稿日: ${parts[0]}`);
          console.log(`    制作者: ${parts[1]}`);
          console.log(`    CR名: ${parts.slice(2, parts.length - 1).join('/')}`);
          console.log(`    LP名: ${parts[parts.length - 1]}`);
        }
      });
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
