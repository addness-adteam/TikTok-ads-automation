// test-smart-plus-budget-update-v2.ts
// 新スマートプラス広告セットの予算更新テスト（広告セットレベル）

import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testSmartPlusBudgetUpdate() {
  // ========================================
  // テスト対象の情報
  // ========================================
  const advertiserId = '7468288053866561553';
  const campaignId = '1849925125750993';
  const adgroupId = '1849925066766370';
  const newBudget = 6000; // 5000円 → 6000円に変更

  const baseUrl = 'https://business-api.tiktok.com/open_api';

  console.log('===========================================');
  console.log('Smart+ 広告セット予算更新テスト');
  console.log('===========================================');
  console.log(`Advertiser ID: ${advertiserId}`);
  console.log(`Campaign ID: ${campaignId}`);
  console.log(`AdGroup ID: ${adgroupId}`);
  console.log(`目標予算: ${newBudget}円`);
  console.log('===========================================\n');

  // アクセストークンを取得
  const oauthToken = await prisma.oAuthToken.findFirst({
    where: { advertiserId: advertiserId },
  });

  if (!oauthToken) {
    console.error('ERROR: No OAuth token found for advertiser:', advertiserId);
    return;
  }

  const accessToken = oauthToken.accessToken;
  console.log('✓ アクセストークン取得成功\n');

  // ========================================
  // Step 1: 現在の広告セット情報を取得
  // ========================================
  console.log('=== Step 1: 現在の広告セット情報を取得 ===');

  try {
    const adgroupResponse = await axios.get(`${baseUrl}/v1.3/smart_plus/adgroup/get/`, {
      headers: { 'Access-Token': accessToken },
      params: {
        advertiser_id: advertiserId,
        filtering: JSON.stringify({ campaign_ids: [campaignId] }),
      },
    });

    if (adgroupResponse.data.code !== 0) {
      console.error('広告セット取得エラー:', adgroupResponse.data);
      return;
    }

    const adgroup = adgroupResponse.data.data?.list?.find(
      (ag: any) => ag.adgroup_id === adgroupId
    );

    if (!adgroup) {
      console.error('広告セットが見つかりません');
      return;
    }

    console.log('広告セット情報:');
    console.log(`  - adgroup_id: ${adgroup.adgroup_id}`);
    console.log(`  - adgroup_name: ${adgroup.adgroup_name}`);
    console.log(`  - 現在の予算: ${adgroup.budget}円`);
    console.log(`  - budget_mode: ${adgroup.budget_mode}`);

    const currentBudget = adgroup.budget;

    console.log(`\n変更前: ${currentBudget}円`);
    console.log(`変更後（目標）: ${newBudget}円`);

    // ========================================
    // Step 2: 広告セット予算を更新
    // ========================================
    console.log('\n=== Step 2: 広告セット予算を更新 ===');
    console.log('Smart+ adgroup budget update API を使用...');

    const updateResponse = await axios.post(
      `${baseUrl}/v1.3/smart_plus/adgroup/budget/update/`,
      {
        advertiser_id: advertiserId,
        budget: [
          { adgroup_id: adgroupId, budget: newBudget },
        ],
      },
      {
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('API レスポンス:', JSON.stringify(updateResponse.data, null, 2));

    if (updateResponse.data.code !== 0) {
      console.error('❌ 予算更新エラー:', updateResponse.data.message);
      return;
    }

    console.log('✓ 広告セット予算更新リクエスト成功');

    // ========================================
    // Step 3: 更新後の予算を確認
    // ========================================
    console.log('\n=== Step 3: 更新後の予算を確認 ===');
    console.log('2秒待機中...');

    await new Promise(resolve => setTimeout(resolve, 2000));

    const verifyResponse = await axios.get(`${baseUrl}/v1.3/smart_plus/adgroup/get/`, {
      headers: { 'Access-Token': accessToken },
      params: {
        advertiser_id: advertiserId,
        filtering: JSON.stringify({ campaign_ids: [campaignId] }),
      },
    });

    const updatedAdgroup = verifyResponse.data.data?.list?.find(
      (ag: any) => ag.adgroup_id === adgroupId
    );
    const updatedBudget = updatedAdgroup?.budget;

    console.log(`更新後の予算: ${updatedBudget}円`);

    // ========================================
    // 結果サマリー
    // ========================================
    console.log('\n===========================================');
    console.log('テスト結果サマリー');
    console.log('===========================================');
    console.log(`変更前: ${currentBudget}円`);
    console.log(`期待値: ${newBudget}円`);
    console.log(`変更後: ${updatedBudget}円`);

    if (updatedBudget === newBudget) {
      console.log('\n✅ テスト成功！予算が正しく更新されました。');
      console.log('TikTok広告マネージャーでも確認してください。');
    } else {
      console.log('\n⚠️ 予算が期待値と異なります。TikTok広告マネージャーで確認してください。');
    }
    console.log('===========================================');

  } catch (error: any) {
    console.error('\n❌ エラーが発生しました:');
    console.error('Message:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testSmartPlusBudgetUpdate()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
