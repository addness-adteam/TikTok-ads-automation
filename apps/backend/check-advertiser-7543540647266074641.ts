/**
 * アドバイザーアカウント 7543540647266074641 の広告確認
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  console.log('========================================');
  console.log('アドバイザー 7543540647266074641 の確認');
  console.log('========================================\n');

  try {
    const targetAdvertiserId = '7543540647266074641';

    // アドバイザーを探す
    const advertiser = await prisma.advertiser.findUnique({
      where: {
        tiktokAdvertiserId: targetAdvertiserId
      },
      include: {
        appeal: true
      }
    });

    if (!advertiser) {
      console.log(`❌ Advertiser ID ${targetAdvertiserId} がデータベースに見つかりませんでした`);
      console.log('\nデータベース内の全Advertiser:');
      const allAdvertisers = await prisma.advertiser.findMany();
      allAdvertisers.forEach((adv, i) => {
        console.log(`  [${i + 1}] ${adv.name} (${adv.tiktokAdvertiserId})`);
      });
      await app.close();
      return;
    }

    console.log(`✓ Advertiser: ${advertiser.name}`);
    console.log(`  Advertiser ID: ${advertiser.tiktokAdvertiserId}`);
    console.log(`  Appeal: ${advertiser.appeal?.name || 'なし'}\n`);

    // アクセストークンを取得
    const token = await prisma.oAuthToken.findFirst({
      where: {
        advertiserId: targetAdvertiserId,
        expiresAt: { gt: new Date() }
      }
    });

    if (!token) {
      console.log('❌ 有効なアクセストークンが見つかりません');
      await app.close();
      return;
    }

    console.log('✓ アクセストークン取得成功\n');

    // 広告を取得
    console.log('広告一覧を取得中...\n');
    const adsResponse = await tiktokService.getAds(
      targetAdvertiserId,
      token.accessToken
    );

    const allAds = adsResponse.data?.list || [];
    console.log(`✓ 広告総数: ${allAds.length}\n`);

    // ステータス別集計
    const statusCounts = new Map<string, number>();
    allAds.forEach((ad: any) => {
      const status = ad.operation_status || 'UNKNOWN';
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    });

    console.log('ステータス別集計:');
    statusCounts.forEach((count, status) => {
      console.log(`  ${status}: ${count}件`);
    });

    // 広告ID 1849185525109761 を検索
    console.log('\n========================================');
    console.log('広告ID 1849185525109761 を検索');
    console.log('========================================\n');

    const targetAdId = '1849185525109761';
    const targetAd = allAds.find((ad: any) => ad.ad_id === targetAdId);

    if (targetAd) {
      console.log('✅ 見つかりました！\n');
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
      console.log('全フィールド');
      console.log('========================================\n');

      const sortedKeys = Object.keys(targetAd).sort();
      sortedKeys.forEach(key => {
        const value = targetAd[key];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          console.log(`${key}: ${value}`);
        }
      });

    } else {
      console.log('❌ 見つかりませんでした');
    }

    // パース可能な広告名の統計
    console.log('\n========================================');
    console.log('パース可能な広告名の統計');
    console.log('========================================\n');

    const extensions = ['.mp4', '.MP4', '.mov', '.MOV', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG'];
    const parseableAds = allAds.filter((ad: any) => {
      const isCreativeName = extensions.some(ext => ad.ad_name && ad.ad_name.includes(ext));
      const parts = ad.ad_name ? ad.ad_name.split('/') : [];
      return parts.length >= 4 && !isCreativeName;
    });

    console.log(`パース可能な広告名: ${parseableAds.length}件\n`);

    if (parseableAds.length > 0) {
      console.log('サンプル（最大5件）:\n');
      parseableAds.slice(0, 5).forEach((ad: any, i: number) => {
        console.log(`[${i + 1}] ${ad.ad_name}`);
        console.log(`    Status: ${ad.operation_status}`);
        console.log(`    Campaign Automation Type: ${ad.campaign_automation_type || 'N/A'}`);
        console.log('');
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
