# Smart+ 予算更新テスト手順

## 概要
新スマートプラス広告の予算増額APIが正しく動作するかをテストする

## 前提条件
- [ ] バックエンドサーバーが起動している
- [ ] TikTok APIのアクセストークンが有効
- [ ] テスト対象の広告が配信中（ENABLE）

---

## テスト手順

### Step 1: テスト対象の広告情報を収集
- [ ] テスト対象の広告を決定（ユーザーが指定）
- [ ] 以下の情報を確認:
  - `advertiser_id`:
  - `campaign_id`:
  - `adgroup_id`:
  - `ad_id` (smart_plus_ad_id):
  - 現在の予算:
  - CBO有効/無効:

### Step 2: テストスクリプトを作成
- [ ] `test-smart-plus-budget-update.ts` を作成
- [ ] 指定された広告の現在の予算を取得
- [ ] 予算を30%増額するAPIを実行
- [ ] 更新後の予算を取得して確認

### Step 3: テスト実行
- [ ] テストスクリプトを実行
- [ ] ログで以下を確認:
  - API呼び出しが成功したか（code: 0）
  - 予算が正しく計算されているか
  - 更新後の予算が反映されているか

### Step 4: TikTok広告マネージャーで確認
- [ ] TikTok広告マネージャーにログイン
- [ ] 該当キャンペーン/広告セットの予算を確認
- [ ] 予算が実際に増額されているか確認

### Step 5: 結果を記録
- [ ] テスト結果（成功/失敗）
- [ ] 変更前の予算:
- [ ] 変更後の予算:
- [ ] エラーがあれば内容を記録

---

## テストスクリプトのテンプレート

```typescript
// test-smart-plus-budget-update.ts
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testSmartPlusBudgetUpdate() {
  // ========================================
  // テスト対象の情報（ユーザーが指定）
  // ========================================
  const advertiserId = 'YOUR_ADVERTISER_ID';
  const campaignId = 'YOUR_CAMPAIGN_ID';
  const adgroupId = 'YOUR_ADGROUP_ID';
  const increaseRate = 0.3; // 30%増額

  // アクセストークンを取得
  const oauthToken = await prisma.oAuthToken.findFirst({
    where: { isActive: true },
  });

  if (!oauthToken) {
    console.error('No active OAuth token found');
    return;
  }

  const accessToken = oauthToken.accessToken;
  const baseUrl = 'https://business-api.tiktok.com/open_api';

  // ========================================
  // Step 1: 現在のキャンペーン情報を取得
  // ========================================
  console.log('=== Step 1: Getting current campaign info ===');

  const campaignResponse = await axios.get(`${baseUrl}/v1.3/campaign/get/`, {
    headers: { 'Access-Token': accessToken },
    params: {
      advertiser_id: advertiserId,
      filtering: JSON.stringify({ campaign_ids: [campaignId] }),
    },
  });

  const campaign = campaignResponse.data.data?.list?.[0];
  console.log('Campaign:', {
    campaign_id: campaign?.campaign_id,
    campaign_name: campaign?.campaign_name,
    budget: campaign?.budget,
    budget_optimize_on: campaign?.budget_optimize_on,
    budget_mode: campaign?.budget_mode,
  });

  const currentBudget = campaign?.budget;
  const isCBOEnabled = campaign?.budget_optimize_on !== false;
  const newBudget = Math.floor(currentBudget * (1 + increaseRate));

  console.log(`\nCurrent budget: ${currentBudget}`);
  console.log(`New budget (30% increase): ${newBudget}`);
  console.log(`CBO enabled: ${isCBOEnabled}`);

  // ========================================
  // Step 2: 予算を更新
  // ========================================
  console.log('\n=== Step 2: Updating budget ===');

  if (isCBOEnabled) {
    // CBO有効：キャンペーン予算を更新
    console.log('Using Smart+ campaign update API...');

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

    console.log('Update response:', JSON.stringify(updateResponse.data, null, 2));
  } else {
    // CBO無効：広告セット予算を更新
    console.log('Using Smart+ adgroup budget update API...');

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

    console.log('Update response:', JSON.stringify(updateResponse.data, null, 2));
  }

  // ========================================
  // Step 3: 更新後の予算を確認
  // ========================================
  console.log('\n=== Step 3: Verifying updated budget ===');

  // 少し待ってから再取得
  await new Promise(resolve => setTimeout(resolve, 2000));

  const verifyResponse = await axios.get(`${baseUrl}/v1.3/campaign/get/`, {
    headers: { 'Access-Token': accessToken },
    params: {
      advertiser_id: advertiserId,
      filtering: JSON.stringify({ campaign_ids: [campaignId] }),
    },
  });

  const updatedCampaign = verifyResponse.data.data?.list?.[0];
  console.log('Updated campaign budget:', updatedCampaign?.budget);

  // ========================================
  // 結果サマリー
  // ========================================
  console.log('\n=== Test Summary ===');
  console.log(`Before: ${currentBudget}`);
  console.log(`Expected: ${newBudget}`);
  console.log(`After: ${updatedCampaign?.budget}`);
  console.log(`Success: ${updatedCampaign?.budget === newBudget ? 'YES' : 'NO'}`);
}

testSmartPlusBudgetUpdate()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

---

## 注意事項
- テスト後、予算を元に戻す場合は手動でTikTok広告マネージャーから変更するか、同じスクリプトで元の値に更新する
- 本番環境の広告に影響を与えるため、テスト対象は慎重に選択する

---

## テスト結果

| 項目 | 値 |
|------|-----|
| テスト日時 | |
| テスト対象広告 | |
| 変更前予算 | |
| 変更後予算（期待値） | |
| 変更後予算（実際） | |
| 結果 | |
| 備考 | |
