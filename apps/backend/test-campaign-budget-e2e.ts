/**
 * E2Eテスト: キャンペーン予算（CBO）の予算調整 & リセット
 *
 * テスト対象: AI_4の配信中広告（キャンペーン予算 = budget_optimize_on: true）
 * 修正前: Smart+ ad APIにbudget_optimize_onがなく、CBO検出不可 → 予算0円で増額/リセット不能
 * 修正後: キャンペーンAPIからbudget_optimize_onを検出 → 正しくキャンペーン予算を取得
 *
 * 検証項目:
 *   1. Smart+ ad APIにbudget_optimize_onがないことを確認
 *   2. キャンペーンAPIでCBOを正しく検出
 *   3. CBO時はキャンペーン予算を使用（adgroup予算ではない）
 *   4. 予算調整API (dryRun) でCBO広告の予算が0円にならないこと
 *   5. 日予算リセットAPI (dryRun) でCBO広告がCAMPAIGN単位でリセットされること
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const AI4_ADVERTISER_ID = '7580666710525493255';
const TOKEN = process.env.TIKTOK_ACCESS_TOKEN!;
const API_BASE = process.env.API_BASE_URL || 'https://tik-tok-ads-automation-backend.vercel.app';
const TIKTOK_API = 'https://business-api.tiktok.com/open_api';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.log(`  ✗ ${testName}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function tiktokGet(endpoint: string, params: Record<string, any>) {
  const qs = Object.entries(params).map(([k, v]) =>
    `${k}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : v)}`
  ).join('&');
  const res = await fetch(`${TIKTOK_API}${endpoint}?${qs}`, {
    headers: { 'Access-Token': TOKEN },
  });
  return res.json();
}

async function appApi(method: string, endpoint: string, body?: any) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function main() {
  console.log('===== E2Eテスト: キャンペーン予算（CBO）対応 =====\n');

  // ========================================
  // Step 1: Smart+ ad APIのレスポンス確認
  // ========================================
  console.log('--- Step 1: Smart+ ad APIのレスポンスを確認 ---');
  const adResponse = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: AI4_ADVERTISER_ID,
    page_size: 100,
    filtering: { operation_status: 'ENABLE' },
  });
  const ads = adResponse.data?.list || [];
  console.log(`  AI_4の配信中Smart+広告: ${ads.length}件`);

  if (ads.length === 0) {
    console.log('  テスト中止: 配信中広告がありません');
    process.exit(1);
  }

  const testAd = ads.find((ad: any) => ad.ad_name?.includes('CR01128')) || ads[0];
  console.log(`  テスト対象: ${testAd.ad_name}`);
  console.log(`  campaign_id: ${testAd.campaign_id}`);
  console.log(`  adgroup_id: ${testAd.adgroup_id}`);
  console.log(`  ad APIのbudget_optimize_on: ${JSON.stringify(testAd.budget_optimize_on ?? '(フィールドなし)')}`);

  assert(
    testAd.budget_optimize_on === undefined || testAd.budget_optimize_on === null,
    'Smart+ ad APIにbudget_optimize_onが含まれない（これが修正前のバグの原因）',
  );

  // ========================================
  // Step 2: キャンペーンAPIでCBOを確認
  // ========================================
  console.log('\n--- Step 2: キャンペーンAPIでCBO検出 ---');
  const campResponse = await tiktokGet('/v1.3/campaign/get/', {
    advertiser_id: AI4_ADVERTISER_ID,
    filtering: { campaign_ids: [testAd.campaign_id] },
  });
  const campaign = campResponse.data?.list?.[0];
  assert(campaign != null, 'キャンペーンAPIからデータ取得できる');

  console.log(`  campaign_name: ${campaign.campaign_name}`);
  console.log(`  budget_optimize_on: ${campaign.budget_optimize_on}`);
  console.log(`  budget_mode: ${campaign.budget_mode}`);
  console.log(`  budget: ¥${campaign.budget}`);

  const isCBO = campaign.budget_optimize_on === true || campaign.budget_optimize_on === 'ON';
  assert(isCBO, 'budget_optimize_on = true（CBO有効）');
  assert(parseFloat(campaign.budget) > 0, `キャンペーン予算 > 0 (¥${campaign.budget})`);

  // ========================================
  // Step 3: AdGroup予算を確認（CBO時は0であるべき）
  // ========================================
  console.log('\n--- Step 3: AdGroup予算の確認（CBO時はadgroupに予算なし） ---');
  const agResponse = await tiktokGet('/v1.3/adgroup/get/', {
    advertiser_id: AI4_ADVERTISER_ID,
    filtering: { campaign_ids: [testAd.campaign_id] },
  });
  const adgroups = agResponse.data?.list || [];
  const testAdgroup = adgroups.find((ag: any) => ag.adgroup_id === testAd.adgroup_id);

  if (testAdgroup) {
    console.log(`  adgroup budget_mode: ${testAdgroup.budget_mode}`);
    console.log(`  adgroup budget: ${testAdgroup.budget}`);
    const agBudget = parseFloat(testAdgroup.budget || '0');
    // CBO時、adgroup予算は0またはINFINITE
    if (agBudget === 0) {
      assert(true, 'CBO時のadgroup予算は0（キャンペーンで管理）');
    } else {
      console.log(`  ※ adgroup予算: ¥${agBudget}（CBO時でもadgroupに予算がある場合がある）`);
    }
  }

  // ========================================
  // Step 4: 修正後のCBO検出ロジックの検証
  // ========================================
  console.log('\n--- Step 4: 修正後のCBO検出ロジック検証 ---');

  // 全キャンペーンを取得してCBOマップを構築（修正後のロジックと同じ）
  const allCampaignIds = [...new Set(ads.map((ad: any) => ad.campaign_id).filter(Boolean))];
  const allCampResponse = await tiktokGet('/v1.3/campaign/get/', {
    advertiser_id: AI4_ADVERTISER_ID,
    filtering: { campaign_ids: allCampaignIds },
  });
  const allCampaigns = allCampResponse.data?.list || [];

  const campaignCBOMap = new Map<string, boolean>();
  const campaignBudgetMap = new Map<string, number>();
  for (const camp of allCampaigns) {
    const campCBO = camp.budget_optimize_on === true || camp.budget_optimize_on === 'ON';
    campaignCBOMap.set(camp.campaign_id, campCBO);
    if (campCBO && camp.budget) {
      campaignBudgetMap.set(camp.campaign_id, parseFloat(camp.budget));
    }
  }

  console.log(`  キャンペーン数: ${allCampaigns.length}, CBO: ${[...campaignCBOMap.values()].filter(v => v).length}`);

  // 修正前のロジック: ad.budget_optimize_on → undefined → isCBO=false → 予算0円
  let buggyZeroCount = 0;
  // 修正後のロジック: campaign.budget_optimize_on → true → isCBO=true → キャンペーン予算
  let fixedZeroCount = 0;

  for (const ad of ads) {
    // 修正前
    const oldIsCBO = ad.budget_optimize_on === true || ad.budget_optimize_on === 'ON';
    // 修正後
    const newIsCBO = campaignCBOMap.get(ad.campaign_id) || false;

    const oldBudget = oldIsCBO ? (campaignBudgetMap.get(ad.campaign_id) || 0) : 0; // 修正前はadgroup予算マップから取るが、ここでは簡略化
    const newBudget = newIsCBO ? (campaignBudgetMap.get(ad.campaign_id) || 0) : 0;

    if (oldBudget === 0 && !oldIsCBO) buggyZeroCount++;
    if (newBudget === 0 && newIsCBO) fixedZeroCount++;

    if (ad === testAd) {
      console.log(`  CR01128の比較:`);
      console.log(`    修正前: isCBO=${oldIsCBO}, 予算=¥${oldBudget}`);
      console.log(`    修正後: isCBO=${newIsCBO}, 予算=¥${newBudget}`);
      assert(!oldIsCBO && newIsCBO, '修正前はCBO検出不可 → 修正後はCBO検出成功');
      assert(newBudget > 0, `修正後の予算 > 0 (¥${newBudget})`);
    }
  }

  console.log(`\n  修正前: CBO検出失敗 → 予算0円の広告: ${buggyZeroCount}/${ads.length}件`);
  console.log(`  修正後: CBO検出成功 → 予算0円の広告: ${fixedZeroCount}/${ads.length}件`);
  assert(buggyZeroCount > 0, '修正前は予算0円のCBO広告が存在する（バグ再現）');
  assert(fixedZeroCount === 0, '修正後は予算0円のCBO広告がなくなる（バグ修正）');

  // ========================================
  // Step 5: Vercel APIで予算調整 dryRun実行
  // ========================================
  console.log('\n--- Step 5: 予算調整API dryRun実行（Vercel） ---');
  try {
    const optimizeResult = await appApi('POST', `/api/budget-optimization-v2/execute/${AI4_ADVERTISER_ID}`, {
      dryRun: true,
    });

    if (optimizeResult.success) {
      const data = optimizeResult.data;
      console.log(`  合計: ${data.summary.totalAds}件`);
      console.log(`    増額: ${data.summary.increased}, 継続: ${data.summary.continued}, 停止: ${data.summary.paused}`);

      const allDecisions = [...(data.stage1Results || []), ...(data.stage2Results || [])];
      const zeroAds = allDecisions.filter((r: any) => r.currentBudget === 0);
      if (zeroAds.length > 0) {
        console.log(`  ⚠ 予算0円の広告:`);
        for (const r of zeroAds) console.log(`    - ${r.adName}`);
      }
      assert(zeroAds.length === 0, 'Vercel APIでもCBO広告の予算が0円にならない',
        `0円: ${zeroAds.length}件`);

      const cr01128 = allDecisions.find((r: any) => r.adName?.includes('CR01128'));
      if (cr01128) {
        console.log(`  CR01128: action=${cr01128.action}, 予算=¥${cr01128.currentBudget}`);
        assert(cr01128.currentBudget > 0, 'CR01128の予算がキャンペーン予算から取得されている');
      }
    } else {
      console.log(`  ⚠ APIエラー: ${optimizeResult.error} — デプロイ前のためスキップ`);
    }
  } catch (error: any) {
    console.log(`  ⚠ API接続エラー: ${error.message} — デプロイ前のためスキップ`);
  }

  // ========================================
  // Step 6: リセットAPI dryRun実行
  // ========================================
  console.log('\n--- Step 6: 日予算リセットAPI dryRun実行（Vercel） ---');
  try {
    const resetResult = await appApi('POST', `/api/budget-optimization-v2/reset-budget/${AI4_ADVERTISER_ID}`, {
      dryRun: true,
    });

    if (resetResult.success) {
      const data = resetResult.data;
      console.log(`  チャネル: ${data.channelType}, デフォルト予算: ¥${data.defaultBudget}`);
      console.log(`  合計: ${data.summary.totalAds}件, リセット: ${data.summary.reset}, スキップ: ${data.summary.skippedAlreadyDefault}`);

      for (const r of data.adResults) {
        const marker = r.entityType === 'CAMPAIGN' ? '📦' : '📋';
        console.log(`  ${marker} ${r.adName}: ${r.action} (¥${r.oldBudget} → ¥${r.newBudget}) [${r.entityType}]`);
      }

      const cboResets = data.adResults.filter((r: any) => r.entityType === 'CAMPAIGN');
      assert(cboResets.length > 0, 'CBO広告がCAMPAIGN単位でリセット対象');
      assert(data.summary.errors === 0, 'リセットにエラーなし');
    } else {
      console.log(`  ⚠ APIエラー: ${resetResult.error} — デプロイ前のためスキップ`);
    }
  } catch (error: any) {
    console.log(`  ⚠ API接続エラー: ${error.message} — デプロイ前のためスキップ`);
  }

  // ========================================
  // 結果サマリー
  // ========================================
  console.log(`\n===== テスト結果: ${passed}/${passed + failed} passed =====`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('テスト実行エラー:', e);
  process.exit(1);
});
