// test-smart-plus-budget-check.ts
// Smart+ 広告セットの予算情報を確認

import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function checkSmartPlusBudget() {
  const advertiserId = '7468288053866561553';
  const campaignId = '1849925125750993';
  const adgroupId = '1849925066766370';

  const baseUrl = 'https://business-api.tiktok.com/open_api';

  console.log('===========================================');
  console.log('Smart+ 広告セット予算確認');
  console.log('===========================================\n');

  // アクセストークンを取得
  const oauthToken = await prisma.oAuthToken.findFirst({
    where: { advertiserId: advertiserId },
  });

  if (!oauthToken) {
    console.error('ERROR: No OAuth token found');
    return;
  }

  const accessToken = oauthToken.accessToken;

  // 広告セット情報を取得（通常のAPI）
  console.log('=== 通常の広告セットAPI ===');
  try {
    const adgroupResponse = await axios.get(`${baseUrl}/v1.3/adgroup/get/`, {
      headers: { 'Access-Token': accessToken },
      params: {
        advertiser_id: advertiserId,
        filtering: JSON.stringify({ adgroup_ids: [adgroupId] }),
      },
    });

    const adgroup = adgroupResponse.data.data?.list?.[0];
    if (adgroup) {
      console.log('広告セット情報:');
      console.log(`  - adgroup_id: ${adgroup.adgroup_id}`);
      console.log(`  - adgroup_name: ${adgroup.adgroup_name}`);
      console.log(`  - budget: ${adgroup.budget}円`);
      console.log(`  - budget_mode: ${adgroup.budget_mode}`);
      console.log(`  - bid_type: ${adgroup.bid_type}`);
    } else {
      console.log('通常APIでは広告セットが見つかりません');
    }
  } catch (error: any) {
    console.log('通常API エラー:', error.response?.data || error.message);
  }

  // Smart+広告セット情報を取得
  console.log('\n=== Smart+ 広告セットAPI ===');
  try {
    const smartPlusAdgroupResponse = await axios.get(`${baseUrl}/v1.3/smart_plus/adgroup/get/`, {
      headers: { 'Access-Token': accessToken },
      params: {
        advertiser_id: advertiserId,
        filtering: JSON.stringify({ campaign_ids: [campaignId] }),
      },
    });

    console.log('Smart+ 広告セット API レスポンス:');
    console.log(JSON.stringify(smartPlusAdgroupResponse.data, null, 2));

    const adgroups = smartPlusAdgroupResponse.data.data?.list || [];
    for (const ag of adgroups) {
      console.log(`\n広告セット: ${ag.adgroup_id}`);
      console.log(`  - adgroup_name: ${ag.adgroup_name}`);
      console.log(`  - budget: ${ag.budget}円`);
      console.log(`  - budget_mode: ${ag.budget_mode}`);
      console.log(`  - current_budget: ${ag.current_budget}`);
    }
  } catch (error: any) {
    console.log('Smart+ API エラー:', error.response?.data || error.message);
  }
}

checkSmartPlusBudget()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
