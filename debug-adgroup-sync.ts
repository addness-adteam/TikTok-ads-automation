import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api';
const ADVERTISER_ID = '7247073333517238273';

async function main() {
  console.log('='.repeat(80));
  console.log('AdGroup同期状態の確認');
  console.log('='.repeat(80));

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: ADVERTISER_ID }
  });

  if (!token) {
    console.log('Token not found');
    return;
  }

  // 問題のSmart+ 広告のadgroup_idを確認
  const targetAdgroupId = '1849941161890833';

  console.log(`\n[Step 1] 問題のAdGroup (${targetAdgroupId}) がDBに存在するか確認...`);
  const dbAdgroup = await prisma.adGroup.findUnique({
    where: { tiktokId: targetAdgroupId },
    include: { campaign: true }
  });

  if (dbAdgroup) {
    console.log('✓ DBに存在');
    console.log(`  名前: ${dbAdgroup.name}`);
    console.log(`  キャンペーン: ${dbAdgroup.campaign?.name}`);
    console.log(`  bidType: ${dbAdgroup.bidType}`);
  } else {
    console.log('✗ DBに存在しない');
  }

  // 問題のキャンペーンを確認
  const targetCampaignId = '1849941151298706';
  console.log(`\n[Step 2] 問題のCampaign (${targetCampaignId}) がDBに存在するか確認...`);
  const dbCampaign = await prisma.campaign.findUnique({
    where: { tiktokId: targetCampaignId }
  });

  if (dbCampaign) {
    console.log('✓ DBに存在');
    console.log(`  名前: ${dbCampaign.name}`);
    console.log(`  objectiveType: ${dbCampaign.objectiveType}`);
  } else {
    console.log('✗ DBに存在しない');
  }

  // TikTok APIからAdGroupを取得してみる
  console.log(`\n[Step 3] TikTok adgroup/get APIから問題のAdGroupを取得...`);
  try {
    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/adgroup/get/`, {
      headers: {
        'Access-Token': token.accessToken,
        'Content-Type': 'application/json',
      },
      params: {
        advertiser_id: ADVERTISER_ID,
        filtering: JSON.stringify({ adgroup_ids: [targetAdgroupId] }),
      },
    });

    console.log(`Response code: ${response.data.code}`);
    console.log(`Message: ${response.data.message}`);
    if (response.data.data?.list?.length > 0) {
      const adgroup = response.data.data.list[0];
      console.log('✓ APIから取得成功');
      console.log(`  名前: ${adgroup.adgroup_name}`);
      console.log(`  campaign_id: ${adgroup.campaign_id}`);
      console.log(`  bid_type: ${adgroup.bid_type}`);
      console.log(`  operation_status: ${adgroup.operation_status}`);
    } else {
      console.log('✗ APIからも取得できない');
    }
  } catch (error: any) {
    console.error('API Error:', error.response?.data || error.message);
  }

  // TikTok APIからCampaignを取得してみる
  console.log(`\n[Step 4] TikTok campaign/get APIから問題のCampaignを取得...`);
  try {
    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/campaign/get/`, {
      headers: {
        'Access-Token': token.accessToken,
        'Content-Type': 'application/json',
      },
      params: {
        advertiser_id: ADVERTISER_ID,
        filtering: JSON.stringify({ campaign_ids: [targetCampaignId] }),
      },
    });

    console.log(`Response code: ${response.data.code}`);
    console.log(`Message: ${response.data.message}`);
    if (response.data.data?.list?.length > 0) {
      const campaign = response.data.data.list[0];
      console.log('✓ APIから取得成功');
      console.log(`  名前: ${campaign.campaign_name}`);
      console.log(`  objective_type: ${campaign.objective_type}`);
      console.log(`  operation_status: ${campaign.operation_status}`);
    } else {
      console.log('✗ APIからも取得できない');
    }
  } catch (error: any) {
    console.error('API Error:', error.response?.data || error.message);
  }

  // Smart+ キャンペーンAPIを確認
  console.log(`\n[Step 5] Smart+ campaign/get APIを確認...`);
  try {
    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/campaign/get/`, {
      headers: {
        'Access-Token': token.accessToken,
        'Content-Type': 'application/json',
      },
      params: {
        advertiser_id: ADVERTISER_ID,
        page_size: 100,
      },
    });

    console.log(`Response code: ${response.data.code}`);
    if (response.data.code === 0 && response.data.data?.list) {
      console.log(`Smart+ campaigns: ${response.data.data.list.length}`);
      for (const camp of response.data.data.list) {
        if (camp.campaign_id === targetCampaignId || camp.smart_plus_campaign_id === targetCampaignId) {
          console.log(`\n  *** 問題のキャンペーンを発見 ***`);
          console.log(`  campaign_id: ${camp.campaign_id}`);
          console.log(`  smart_plus_campaign_id: ${camp.smart_plus_campaign_id}`);
          console.log(`  campaign_name: ${camp.campaign_name}`);
          console.log(`  operation_status: ${camp.operation_status}`);
        }
      }
    }
  } catch (error: any) {
    console.error('Smart+ Campaign API Error:', error.response?.data || error.message);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
