/**
 * 広告データの構造確認スクリプト
 * ad_nameが本当に広告名なのか、CR名なのかを確認
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { TiktokService } from './src/tiktok/tiktok.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const tiktokService = app.get(TiktokService);

  const advertiserId = '7543540381615800337';
  const targetCampaignId = '1848372851324929';
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN || '';

  if (!accessToken) {
    console.error('❌ TIKTOK_ACCESS_TOKEN not found');
    process.exit(1);
  }

  console.log('========================================');
  console.log('広告データ構造の確認');
  console.log('========================================');
  console.log(`Advertiser ID: ${advertiserId}`);
  console.log(`Target Campaign ID: ${targetCampaignId}\n`);

  try {
    // 広告を取得
    const adsResponse = await tiktokService.getAds(advertiserId, accessToken);
    const allAds = adsResponse.data?.list || [];
    const campaignAds = allAds.filter((ad: any) => ad.campaign_id === targetCampaignId);

    if (campaignAds.length === 0) {
      console.log('❌ キャンペーン配下の広告が見つかりませんでした');
      await app.close();
      return;
    }

    console.log(`✓ キャンペーン配下の広告数: ${campaignAds.length}\n`);

    // 最初の広告の完全なデータを表示
    console.log('========================================');
    console.log('広告データの完全な構造（最初の1件）');
    console.log('========================================');
    const firstAd = campaignAds[0];
    console.log(JSON.stringify(firstAd, null, 2));

    console.log('\n========================================');
    console.log('主要フィールドの確認');
    console.log('========================================');
    console.log(`ad_id: ${firstAd.ad_id}`);
    console.log(`ad_name: ${firstAd.ad_name}`);
    console.log(`ad_nameの型: ${typeof firstAd.ad_name}`);
    console.log(`ad_nameが空文字: ${firstAd.ad_name === ''}`);
    console.log(`ad_nameがnull: ${firstAd.ad_name === null}`);
    console.log(`ad_nameがundefined: ${firstAd.ad_name === undefined}`);
    console.log(`ad_text: ${firstAd.ad_text}`);
    console.log(`video_id: ${firstAd.video_id}`);
    console.log(`image_ids: ${JSON.stringify(firstAd.image_ids)}`);

    // 全広告のad_nameを一覧表示
    console.log('\n========================================');
    console.log('全広告のad_name一覧');
    console.log('========================================');
    campaignAds.forEach((ad: any, index: number) => {
      const adNameValue = ad.ad_name;
      const adNameDisplay =
        adNameValue === undefined ? '(undefined)' :
        adNameValue === null ? '(null)' :
        adNameValue === '' ? '(空文字)' :
        adNameValue;

      console.log(`[${index + 1}] Ad ID: ${ad.ad_id}`);
      console.log(`    ad_name: ${adNameDisplay}`);
      console.log(`    ad_nameの長さ: ${adNameValue ? adNameValue.length : 0}`);
    });

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
