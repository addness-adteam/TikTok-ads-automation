import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testWithoutBilling() {
  console.log('🎯 billing_eventなしでAdGroup作成テスト\n');

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
    const campaignName = 'テスト_NoBilling_' + timestamp;

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

    // AdGroup作成 (billing_eventを除外)
    console.log('📦 ステップ2: AdGroup作成中 (billing_eventなし)...\n');

    const today = new Date();
    const dateStr = `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const adgroupName = `${dateStr} NoBilling`;

    const currentHour = today.getHours();
    const startTime = currentHour < 15
      ? today.toISOString()
      : new Date(today.setDate(today.getDate() + 1)).toISOString().split('T')[0] + 'T00:00:00Z';

    const endTime = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();

    const requestBody = {
      advertiser_id: tiktokAdvertiserId,
      campaign_id: campaignId,
      adgroup_name: adgroupName,
      promotion_type: 'WEBSITE',
      placement_type: 'PLACEMENT_TYPE_NORMAL',
      placements: ['PLACEMENT_TIKTOK'],
      location_ids: ['6252001'],
      budget_mode: 'BUDGET_MODE_DAY',
      budget: '5000',
      bid_type: 'BID_TYPE_NO_BID',
      // billing_event: 'OCPM', ← 除外
      optimization_goal: 'CONVERT',
      schedule_type: 'SCHEDULE_START_END',
      schedule_start_time: startTime,
      schedule_end_time: endTime,
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

    console.log('✅ AdGroup作成成功！\n');
    console.log('📊 レスポンス:');
    console.log('─'.repeat(80));
    console.log(JSON.stringify(adgroupResponse.data, null, 2));
    console.log('─'.repeat(80));
    console.log('');

    if (adgroupResponse.data.code === 0 && adgroupResponse.data.data?.adgroup_id) {
      console.log('\n' + '='.repeat(80));
      console.log('🎉 成功！ billing_eventを除外したら AdGroup が作成できました！');
      console.log('✅ AdGroup ID: ' + adgroupResponse.data.data.adgroup_id);
      console.log('='.repeat(80));
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

testWithoutBilling().catch(console.error);
