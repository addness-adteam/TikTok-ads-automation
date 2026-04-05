/**
 * ページネーション対応で全アカウントから広告を検索
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
  console.log(`広告ID ${targetAdId} をページネーション対応で検索`);
  console.log('========================================\n');

  try {
    const advertisers = await prisma.advertiser.findMany({
      include: {
        appeal: true
      }
    });

    console.log(`対象アカウント数: ${advertisers.length}\n`);

    const baseUrl = process.env.TIKTOK_API_BASE_URL || '';

    for (const advertiser of advertisers) {
      console.log(`\n[${advertiser.name}]`);
      console.log(`Advertiser ID: ${advertiser.tiktokAdvertiserId}`);

      // アクセストークンを取得
      const token = await prisma.oAuthToken.findFirst({
        where: {
          advertiserId: advertiser.tiktokAdvertiserId,
          expiresAt: { gt: new Date() }
        }
      });

      if (!token) {
        console.log('⚠️  有効なトークンなし - スキップ');
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
            console.log(`  ページ${page}を取得中...`);
          }
        }

        console.log(`✓ 広告総数: ${allAds.length}`);

        // 対象広告を検索
        const targetAd = allAds.find((ad: any) => ad.ad_id === targetAdId);

        if (targetAd) {
          console.log('\n🎯 ===== 見つかりました！ =====');
          console.log(`\nAdvertiser: ${advertiser.name}`);
          console.log(`Advertiser ID: ${advertiser.tiktokAdvertiserId}`);
          console.log(`Appeal: ${advertiser.appeal?.name || 'なし'}\n`);

          console.log('========================================');
          console.log('広告の詳細');
          console.log('========================================\n');

          console.log(`Ad ID: ${targetAd.ad_id}`);
          console.log(`Ad Name: ${targetAd.ad_name}`);
          console.log(`Status: ${targetAd.operation_status}`);
          console.log(`Campaign ID: ${targetAd.campaign_id}`);
          console.log(`Campaign Name: ${targetAd.campaign_name}`);
          console.log(`Campaign Automation Type: ${targetAd.campaign_automation_type || 'N/A'}`);
          console.log(`AdGroup ID: ${targetAd.adgroup_id}`);
          console.log(`AdGroup Name: ${targetAd.adgroup_name}`);

          // 判定
          const extensions = ['.mp4', '.MP4', '.mov', '.MOV', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG'];
          const isCreativeName = extensions.some(ext => targetAd.ad_name && targetAd.ad_name.includes(ext));
          const parts = targetAd.ad_name ? targetAd.ad_name.split('/') : [];
          const isParseable = parts.length >= 4;

          console.log('\n========================================');
          console.log('広告名の判定');
          console.log('========================================\n');

          console.log(`ad_name: "${targetAd.ad_name}"`);
          console.log(`CR名判定: ${isCreativeName ? 'Yes (CR名)' : 'No (手動設定)'}`);
          console.log(`パース可能: ${isParseable ? 'Yes' : 'No'}`);

          if (isParseable && !isCreativeName) {
            console.log('\n✅ パース可能な形式です！');
            console.log(`  出稿日: ${parts[0]}`);
            console.log(`  制作者: ${parts[1]}`);
            console.log(`  CR名: ${parts.slice(2, parts.length - 1).join('/')}`);
            console.log(`  LP名: ${parts[parts.length - 1]}`);
          }

          // 全フィールドを表示
          console.log('\n========================================');
          console.log('全フィールド（スカラー値のみ）');
          console.log('========================================\n');

          const sortedKeys = Object.keys(targetAd).sort();
          sortedKeys.forEach(key => {
            const value = targetAd[key];
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
              console.log(`${key}: ${value}`);
            } else if (value === null || value === undefined) {
              console.log(`${key}: [null/undefined]`);
            }
          });

          // 見つかったので終了
          await app.close();
          return;
        }

      } catch (error: any) {
        console.log(`❌ エラー: ${error.message}`);
      }
    }

    console.log('\n========================================');
    console.log('結果');
    console.log('========================================\n');
    console.log(`❌ 広告ID ${targetAdId} はどのアカウントにも見つかりませんでした`);
    console.log('\n考えられる理由:');
    console.log('  1. 広告が削除された');
    console.log('  2. 広告IDが異なる');
    console.log('  3. 別のTikTok Adsアカウント（このシステムに登録されていない）');

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
