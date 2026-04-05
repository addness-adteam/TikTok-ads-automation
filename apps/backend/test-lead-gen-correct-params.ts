import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testLeadGenCorrectParams() {
  console.log('🎯 LEAD_GENERATION 正しいパラメータでテスト開始\n');
  console.log('既存のAdGroupから取得した設定を使用します\n');

  const tiktokAdvertiserId = '7247073333517238273';

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: tiktokAdvertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found');
    await prisma.$disconnect();
    return;
  }
  console.log('✅ アクセストークン取得成功\n');

  try {
    // Campaign作成
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:-]/g, '');
    const campaignName = 'テスト_LEAD_Correct_' + timestamp;

    console.log('📦 ステップ1: Campaign作成中...');
    const campaignResponse = await axios.post(
      'https://business-api.tiktok.com/open_api/v1.3/campaign/create/',
      {
        advertiser_id: tiktokAdvertiserId,
        campaign_name: campaignName,
        objective_type: 'LEAD_GENERATION',
        budget_mode: 'BUDGET_MODE_INFINITE',
      },
      {
        headers: {
          'Access-Token': token.accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    const campaignId = String(campaignResponse.data.data.campaign_id);
    console.log(`✅ Campaign作成成功: ${campaignId}\n`);

    // AdGroup作成 - 既存のAdGroupと同じ設定
    console.log('📦 ステップ2: AdGroup作成中（既存AdGroupと同じ設定）...\n');

    const today = new Date();
    const dateStr = `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const adgroupName = `${dateStr} テスト正しい設定`;

    const currentHour = today.getHours();
    const startTime = currentHour < 15
      ? today.toISOString().replace('T', ' ').split('.')[0]
      : new Date(today.setDate(today.getDate() + 1)).toISOString().split('T')[0] + ' 00:00:00';

    const requestBody = {
      advertiser_id: tiktokAdvertiserId,
      campaign_id: campaignId,
      adgroup_name: adgroupName,
      promotion_type: 'LEAD_GENERATION',
      promotion_target_type: 'EXTERNAL_WEBSITE', // ← 追加
      placement_type: 'PLACEMENT_TYPE_NORMAL',
      placements: ['PLACEMENT_TIKTOK'],
      location_ids: ['6252001'], // 日本全体
      languages: ['ja'],
      age_groups: ['AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_100'],
      gender: 'GENDER_UNLIMITED',
      budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET', // ← 変更
      budget: '5000',
      bid_type: 'BID_TYPE_NO_BID',
      billing_event: 'OCPM',
      optimization_goal: 'CONVERT',
      optimization_event: 'ON_WEB_REGISTER', // ← 文字列定数に変更
      pixel_id: '7388088697557663760',
      pacing: 'PACING_MODE_SMOOTH', // ← 追加
      schedule_type: 'SCHEDULE_FROM_NOW', // ← 変更
      schedule_start_time: startTime, // ← 追加（SCHEDULE_FROM_NOWでも必要）
      skip_learning_phase: true, // ← 追加（既存AdGroupで使用）
      video_download_disabled: true, // ← 追加（既存AdGroupで使用）
      click_attribution_window: 'SEVEN_DAYS', // ← 追加（既存AdGroupで使用）
      view_attribution_window: 'ONE_DAY', // ← 追加（既存AdGroupで使用）
      brand_safety_type: 'STANDARD_INVENTORY', // ← 追加（既存AdGroupで使用）
    };

    console.log('📋 リクエストボディ:');
    console.log('─'.repeat(80));
    console.log(JSON.stringify(requestBody, null, 2));
    console.log('─'.repeat(80));
    console.log('');

    const adgroupResponse = await axios.post(
      'https://business-api.tiktok.com/open_api/v1.3/adgroup/create/',
      requestBody,
      {
        headers: {
          'Access-Token': token.accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('📊 レスポンス:');
    console.log('─'.repeat(80));
    console.log(JSON.stringify(adgroupResponse.data, null, 2));
    console.log('─'.repeat(80));
    console.log('');

    if (adgroupResponse.data.code === 0 && adgroupResponse.data.data?.adgroup_id) {
      console.log('\n' + '='.repeat(80));
      console.log('🎉 🎉 🎉 LEAD_GENERATION AdGroup作成成功！');
      console.log('✅ AdGroup ID: ' + adgroupResponse.data.data.adgroup_id);
      console.log('='.repeat(80));
      console.log('\n💡 成功した設定:');
      console.log('  - optimization_event: "ON_WEB_REGISTER" (文字列定数)');
      console.log('  - schedule_type: "SCHEDULE_FROM_NOW"');
      console.log('  - budget_mode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET"');
      console.log('  - promotion_target_type: "EXTERNAL_WEBSITE"');
      console.log('  - pacing: "PACING_MODE_SMOOTH"');
    } else {
      console.log('\n❌ AdGroup作成失敗');
      console.log('エラーメッセージ:', adgroupResponse.data.message);
    }

  } catch (error: any) {
    console.log('❌ エラー発生\n');

    if (error.response?.data) {
      console.log('レスポンスデータ:');
      console.log('─'.repeat(80));
      console.log(JSON.stringify(error.response.data, null, 2));
      console.log('─'.repeat(80));
    } else {
      console.log('エラーメッセージ:', error.message);
    }
  }

  await prisma.$disconnect();
}

testLeadGenCorrectParams().catch(console.error);
