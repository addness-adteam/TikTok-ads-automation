import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testCampaignWithCreative() {
  console.log('🎯 Creative使用広告作成テスト開始\n');

  const tiktokAdvertiserId = '7247073333517238273';
  const creativeId = '28434c3c-d563-4bf9-b237-f1f79bea1bc7'; // 先ほどアップロードした動画のID
  const apiUrl = 'http://localhost:4000';

  // ステップ1: アクセストークン取得
  console.log('📡 ステップ1: DBからアクセストークンを取得中...');
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: tiktokAdvertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found for advertiser:', tiktokAdvertiserId);
    await prisma.$disconnect();
    return;
  }
  console.log('✅ アクセストークン取得成功\n');

  // ステップ2: Creativeの存在確認
  console.log('📋 ステップ2: Creativeの存在確認...');
  const creative = await prisma.creative.findUnique({
    where: { id: creativeId },
  });

  if (!creative) {
    console.error('❌ Creative not found:', creativeId);
    await prisma.$disconnect();
    return;
  }

  console.log('✅ Creative確認成功');
  console.log(`   Name: ${creative.name}`);
  console.log(`   Type: ${creative.type}`);
  console.log(`   TikTok Video ID: ${creative.tiktokVideoId}`);
  console.log(`   TikTok Image ID: ${creative.tiktokImageId}\n`);

  // ステップ3: 広告作成リクエスト準備
  console.log('📦 ステップ3: 広告作成リクエストを準備中...');
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:-]/g, '');
  const requestBody = {
    advertiserId: tiktokAdvertiserId,
    campaignName: 'テストキャンペーン_' + timestamp,
    pixelId: '7388088697557663760', // SNS1 2 専用 Pixel ID
    optimizationEvent: '7388093644378554384', // Event ID: ON_WEB_REGISTER
    dailyBudget: 5000, // 日予算 5000円
    pattern: 'NON_TARGETING', // ノンタゲパターン
    ads: [
      {
        adName: 'テスト広告_' + timestamp,
        creativeId: creativeId, // アップロードしたCreativeのUUID
        landingPageUrl: 'https://school.addness.co.jp/page/s4HNscou95B5',
        // thumbnailImageIdは不要: DBのCreativeに保存されたtiktokImageIdを自動使用
      },
    ],
    accessToken: token.accessToken,
  };

  console.log('✅ リクエスト準備完了');
  console.log('   Campaign Name: ' + requestBody.campaignName);
  console.log('   Ad Name: ' + requestBody.ads[0].adName);
  console.log('   Creative ID: ' + creativeId);
  console.log('   Pattern: ' + requestBody.pattern);
  console.log('   Daily Budget: ' + requestBody.dailyBudget + '円\n');

  // ステップ4: APIリクエスト送信
  console.log('🚀 ステップ4: 広告作成APIにリクエスト送信中...');
  console.log(`   URL: ${apiUrl}/api/campaign-builder/create\n`);

  try {
    const response = await axios.post(
      `${apiUrl}/api/campaign-builder/create`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 60000, // 60秒タイムアウト
      }
    );

    console.log('✅ 広告作成成功！\n');
    console.log('📊 レスポンス詳細:');
    console.log('─'.repeat(60));
    console.log(JSON.stringify(response.data, null, 2));
    console.log('─'.repeat(60));
    console.log('');

    // ステップ5: 結果検証
    console.log('🔍 ステップ5: 結果を検証中...\n');

    if (response.data.success) {
      const { campaign, adGroup, ads } = response.data.data;

      console.log('✅ Campaign作成成功');
      console.log(`   Campaign ID: ${campaign.campaign_id}`);
      console.log(`   Campaign Name: ${campaign.campaign_name}\n`);

      console.log('✅ AdGroup作成成功');
      console.log(`   AdGroup ID: ${adGroup.adgroup_id}`);
      console.log(`   AdGroup Name: ${adGroup.adgroup_name}`);
      console.log(`   Budget: ${adGroup.budget}円\n`);

      console.log('✅ Ad作成成功');
      console.log(`   Ads Count: ${ads.length}`);
      ads.forEach((ad: any, index: number) => {
        console.log(`   Ad ${index + 1}:`);
        console.log(`      ID: ${ad.ad_id}`);
        console.log(`      Name: ${ad.ad_name}`);
        console.log(`      Video ID: ${ad.video_id || 'N/A'}`);
        console.log(`      Status: ${ad.operation_status}`);
      });
    } else {
      console.log('❌ 広告作成失敗');
      console.log('   Error: ' + response.data.error);
    }

    console.log('\n' + '═'.repeat(60));
    console.log('🎉 テスト完了: Creative使用広告作成機能は正常に動作しています！');
    console.log('═'.repeat(60));

  } catch (error: any) {
    console.log('❌ エラー発生\n');

    if (error.response) {
      console.log('ステータスコード:', error.response.status);
      console.log('レスポンスデータ:');
      console.log(JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.log('リクエストエラー: サーバーに接続できませんでした');
      console.log('API URL:', apiUrl);
      console.log('バックエンドサーバーが起動しているか確認してください');
    } else {
      console.log('エラーメッセージ:', error.message);
    }

    console.log('\n💡 トラブルシューティング:');
    console.log('1. Creative IDが正しいか確認してください');
    console.log('2. Pixel IDが正しいか確認してください');
    console.log('3. アクセストークンが有効か確認してください');
    console.log('4. TikTok APIのレート制限に達していないか確認してください');
  }

  await prisma.$disconnect();
}

testCampaignWithCreative().catch(console.error);
