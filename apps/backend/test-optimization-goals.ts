import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testOptimizationGoals() {
  console.log('🎯 AdGroup optimization_goal テスト開始\n');

  const tiktokAdvertiserId = '7247073333517238273';

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: tiktokAdvertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found');
    await prisma.$disconnect();
    return;
  }

  // LEAD_GENERATION キャンペーンで試すoptimization_goal候補
  const optimizationGoals = [
    'CONVERT',
    'LEAD_GENERATION',
    'LEAD',
    'VALUE',
    'CLICK',
    'REACH',
  ];

  for (const optimizationGoal of optimizationGoals) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`テスト: optimization_goal = "${optimizationGoal}"`);
    console.log('='.repeat(80));

    try {
      // Campaign作成
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:-]/g, '');
      const campaignName = `テスト_${optimizationGoal}_${timestamp}`;

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
      console.log(`✅ Campaign作成成功: ${campaignId}`);

      // AdGroup作成
      const today = new Date();
      const dateStr = `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
      const adgroupName = `${dateStr} ${optimizationGoal}`;

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
        billing_event: 'OCPM',
        optimization_goal: optimizationGoal,
        schedule_type: 'SCHEDULE_START_END',
        schedule_start_time: startTime,
        schedule_end_time: endTime,
      };

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

      if (adgroupResponse.data.code === 0) {
        console.log(`✅ ✅ ✅ AdGroup作成成功！ optimization_goal="${optimizationGoal}" が有効です！`);
        console.log(`   AdGroup ID: ${adgroupResponse.data.data.adgroup_id}`);
        console.log('\n🎉 正しい optimization_goal を見つけました！');
        break;
      } else {
        console.log(`❌ AdGroup作成失敗: ${adgroupResponse.data.message}`);
      }

    } catch (error: any) {
      if (error.response?.data) {
        const errorData = error.response.data;
        console.log(`❌ エラー: ${errorData.message}`);

        // optimization_goalに関する具体的なエラーなら表示
        if (errorData.message.includes('optimization_goal')) {
          console.log('   ⚠️  optimization_goalに関連するエラーです');
        }
      } else {
        console.log(`❌ エラー: ${error.message}`);
      }
    }

    // APIレート制限を避けるため少し待機
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '='.repeat(80));
  console.log('テスト完了');
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

testOptimizationGoals().catch(console.error);
