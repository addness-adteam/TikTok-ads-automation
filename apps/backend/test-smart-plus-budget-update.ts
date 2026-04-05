// test-smart-plus-budget-update.ts
// 新スマートプラス広告の予算更新テスト

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
  const adId = '1849925089223681';
  const newBudget = 6000; // 5000円 → 6000円に変更

  const baseUrl = 'https://business-api.tiktok.com/open_api';

  console.log('===========================================');
  console.log('Smart+ 予算更新テスト');
  console.log('===========================================');
  console.log(`Advertiser ID: ${advertiserId}`);
  console.log(`Campaign ID: ${campaignId}`);
  console.log(`AdGroup ID: ${adgroupId}`);
  console.log(`Ad ID: ${adId}`);
  console.log(`目標予算: ${newBudget}円`);
  console.log('===========================================\n');

  // アクセストークンを取得（指定したadvertiserIdのトークン）
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
  // Step 1: 現在のキャンペーン情報を取得
  // ========================================
  console.log('=== Step 1: 現在のキャンペーン情報を取得 ===');

  try {
    const campaignResponse = await axios.get(`${baseUrl}/v1.3/campaign/get/`, {
      headers: { 'Access-Token': accessToken },
      params: {
        advertiser_id: advertiserId,
        filtering: JSON.stringify({ campaign_ids: [campaignId] }),
      },
    });

    if (campaignResponse.data.code !== 0) {
      console.error('キャンペーン取得エラー:', campaignResponse.data);
      return;
    }

    const campaign = campaignResponse.data.data?.list?.[0];
    if (!campaign) {
      console.error('キャンペーンが見つかりません');
      return;
    }

    console.log('キャンペーン情報:');
    console.log(`  - campaign_id: ${campaign.campaign_id}`);
    console.log(`  - campaign_name: ${campaign.campaign_name}`);
    console.log(`  - 現在の予算: ${campaign.budget}円`);
    console.log(`  - budget_optimize_on (CBO): ${campaign.budget_optimize_on}`);
    console.log(`  - budget_mode: ${campaign.budget_mode}`);

    const currentBudget = campaign.budget;
    const isCBOEnabled = campaign.budget_optimize_on !== false;

    console.log(`\n現在の予算: ${currentBudget}円`);
    console.log(`目標予算: ${newBudget}円`);
    console.log(`CBO有効: ${isCBOEnabled ? 'はい' : 'いいえ'}`);

    // ========================================
    // Step 2: 予算を更新
    // ========================================
    console.log('\n=== Step 2: 予算を更新 ===');

    if (isCBOEnabled) {
      // CBO有効：キャンペーン予算を更新
      console.log('CBO有効のため、Smart+ campaign update API を使用...');

      const updateResponse = await axios.post(
        `${baseUrl}/v1.3/smart_plus/campaign/update/`,
        {
          advertiser_id: advertiserId,
          campaign_id: campaignId,
          budget: newBudget,
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

      console.log('✓ キャンペーン予算更新リクエスト成功');
    } else {
      // CBO無効：広告セット予算を更新
      console.log('CBO無効のため、Smart+ adgroup budget update API を使用...');

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
    }

    // ========================================
    // Step 3: 更新後の予算を確認
    // ========================================
    console.log('\n=== Step 3: 更新後の予算を確認 ===');
    console.log('2秒待機中...');

    await new Promise(resolve => setTimeout(resolve, 2000));

    const verifyResponse = await axios.get(`${baseUrl}/v1.3/campaign/get/`, {
      headers: { 'Access-Token': accessToken },
      params: {
        advertiser_id: advertiserId,
        filtering: JSON.stringify({ campaign_ids: [campaignId] }),
      },
    });

    const updatedCampaign = verifyResponse.data.data?.list?.[0];
    const updatedBudget = updatedCampaign?.budget;

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
