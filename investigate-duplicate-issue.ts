import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api';
const ADVERTISER_ID = '7247073333517238273';

async function main() {
  console.log('='.repeat(80));
  console.log('重複ID問題の調査');
  console.log('='.repeat(80));

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: ADVERTISER_ID }
  });

  if (!token) {
    console.log('Token not found');
    return;
  }

  // 問題のAdGroup
  const targetAdgroupId = '1849941161890833';

  // 1. 通常のad/get APIで取得される広告
  console.log('\n[Step 1] ad/get APIで取得される広告...');
  const regularResponse = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/ad/get/`, {
    headers: {
      'Access-Token': token.accessToken,
      'Content-Type': 'application/json',
    },
    params: {
      advertiser_id: ADVERTISER_ID,
      filtering: JSON.stringify({
        adgroup_ids: [targetAdgroupId],
      }),
      page_size: 100,
    },
  });

  const regularAds = regularResponse.data.data?.list || [];
  console.log(`取得数: ${regularAds.length}`);
  for (const ad of regularAds) {
    console.log(`\n  ad_id: ${ad.ad_id}`);
    console.log(`  ad_name: ${ad.ad_name}`);
    console.log(`  video_id: ${ad.video_id}`);
    console.log(`  smart_plus_ad_id: ${ad.smart_plus_ad_id || 'N/A'}`);
  }

  // 2. smart_plus/ad/get APIで取得される広告
  console.log('\n[Step 2] smart_plus/ad/get APIで取得される広告...');
  const smartPlusResponse = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/ad/get/`, {
    headers: {
      'Access-Token': token.accessToken,
      'Content-Type': 'application/json',
    },
    params: {
      advertiser_id: ADVERTISER_ID,
      filtering: JSON.stringify({
        adgroup_ids: [targetAdgroupId],
      }),
      page_size: 100,
    },
  });

  const smartPlusAds = smartPlusResponse.data.data?.list || [];
  console.log(`取得数: ${smartPlusAds.length}`);
  for (const ad of smartPlusAds) {
    console.log(`\n  smart_plus_ad_id: ${ad.smart_plus_ad_id}`);
    console.log(`  ad_id: ${ad.ad_id || 'N/A'}`);
    console.log(`  ad_name: ${ad.ad_name}`);

    // creative_listからvideo_idを取得
    const creativeList = ad.creative_list || [];
    const enabledCreative = creativeList.find((c: any) => c.material_operation_status === 'ENABLE');
    if (enabledCreative?.creative_info?.video_info?.video_id) {
      console.log(`  video_id (from creative_list): ${enabledCreative.creative_info.video_info.video_id}`);
    }
  }

  // 3. video_idの比較
  console.log('\n[Step 3] video_idの比較（同一動画か？）...');

  const regularVideoIds = regularAds.map((ad: any) => ad.video_id);
  const smartPlusVideoIds = smartPlusAds.map((ad: any) => {
    const creativeList = ad.creative_list || [];
    const enabledCreative = creativeList.find((c: any) => c.material_operation_status === 'ENABLE');
    return enabledCreative?.creative_info?.video_info?.video_id;
  });

  console.log(`ad/get のvideo_ids: ${JSON.stringify(regularVideoIds)}`);
  console.log(`smart_plus/ad/get のvideo_ids: ${JSON.stringify(smartPlusVideoIds)}`);

  // 重複チェック
  const commonVideoIds = regularVideoIds.filter((vid: string) => smartPlusVideoIds.includes(vid));
  console.log(`\n共通のvideo_id: ${JSON.stringify(commonVideoIds)}`);

  if (commonVideoIds.length > 0) {
    console.log('\n*** 同じvideo_idを持つ広告が両方のAPIで返されている ***');
    console.log('これは、同じ物理的な広告に対して2つの異なるIDが存在することを意味します');
  }

  // 4. DBの状態を確認
  console.log('\n[Step 4] DBの状態...');
  const dbAds = await prisma.ad.findMany({
    where: {
      adGroup: {
        tiktokId: targetAdgroupId
      }
    },
    include: {
      adGroup: true
    }
  });

  console.log(`DBの広告数: ${dbAds.length}`);
  for (const ad of dbAds) {
    console.log(`\n  tiktokId: ${ad.tiktokId}`);
    console.log(`  name: ${ad.name}`);
    console.log(`  createdAt: ${ad.createdAt.toISOString()}`);
  }

  // 5. scheduler.serviceのSmart+同期処理をシミュレート
  console.log('\n[Step 5] 同期処理のシミュレーション（問題の広告）...');

  const targetAd = smartPlusAds.find((ad: any) => ad.ad_name?.includes('CR00586'));
  if (targetAd) {
    const adId = targetAd.smart_plus_ad_id || targetAd.ad_id;
    console.log(`\n処理対象: ${targetAd.ad_name}`);
    console.log(`adId (for DB): ${adId}`);

    // AdGroup検索
    const adgroup = await prisma.adGroup.findUnique({
      where: { tiktokId: String(targetAd.adgroup_id) }
    });
    console.log(`AdGroup found: ${adgroup ? 'YES' : 'NO'}`);

    // Creative検索
    const creativeList = targetAd.creative_list || [];
    const enabledCreative = creativeList.find((c: any) => c.material_operation_status === 'ENABLE');
    console.log(`enabledCreative found: ${enabledCreative ? 'YES' : 'NO'}`);

    if (enabledCreative?.creative_info) {
      const videoId = enabledCreative.creative_info.video_info?.video_id;
      console.log(`video_id: ${videoId}`);

      if (videoId) {
        const creative = await prisma.creative.findFirst({
          where: { tiktokVideoId: videoId }
        });
        console.log(`Creative in DB: ${creative ? `YES (${creative.id})` : 'NO'}`);
      }
    }

    // 問題: この時点で、adIdでupsertしようとするが、
    // 同じCreative（video_id）を使う別の広告（ad_id）が既にDBにある
    console.log(`\n*** 問題の可能性 ***`);
    console.log(`同じvideo_idを持つ広告がDBに既に存在するか確認...`);

    const videoId = enabledCreative?.creative_info?.video_info?.video_id;
    if (videoId) {
      const creative = await prisma.creative.findFirst({
        where: { tiktokVideoId: videoId }
      });

      if (creative) {
        const adsWithSameCreative = await prisma.ad.findMany({
          where: { creativeId: creative.id }
        });

        console.log(`同じCreativeを使う広告: ${adsWithSameCreative.length} 件`);
        for (const a of adsWithSameCreative) {
          console.log(`  - ${a.name} (tiktokId: ${a.tiktokId})`);
        }
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
