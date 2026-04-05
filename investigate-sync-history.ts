import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api';
const ADVERTISER_ID = '7247073333517238273';

async function main() {
  console.log('='.repeat(80));
  console.log('同期履歴の詳細調査');
  console.log('='.repeat(80));

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: ADVERTISER_ID }
  });

  if (!token) {
    console.log('Token not found');
    return;
  }

  // 問題の広告
  const targetSmartPlusAdId = '1849941219656738';
  const targetAdName = '251128/高橋海斗/ピザ→問題ないです（リール投稿）/LP1-CR00586';

  console.log(`\n問題の広告: ${targetAdName}`);
  console.log(`smart_plus_ad_id: ${targetSmartPlusAdId}`);

  // 1. APIから問題の広告の詳細を取得
  console.log('\n[Step 1] APIから問題の広告の詳細を取得...');

  const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/ad/get/`, {
    headers: {
      'Access-Token': token.accessToken,
      'Content-Type': 'application/json',
    },
    params: {
      advertiser_id: ADVERTISER_ID,
      filtering: JSON.stringify({
        smart_plus_ad_ids: [targetSmartPlusAdId],
      }),
      page_size: 100,
    },
  });

  if (response.data.code === 0 && response.data.data?.list?.length > 0) {
    const ad = response.data.data.list[0];
    console.log('\nAPIから取得した広告データ:');
    console.log(`  ad_name: ${ad.ad_name}`);
    console.log(`  smart_plus_ad_id: ${ad.smart_plus_ad_id}`);
    console.log(`  adgroup_id: ${ad.adgroup_id}`);
    console.log(`  campaign_id: ${ad.campaign_id}`);
    console.log(`  operation_status: ${ad.operation_status}`);
    console.log(`  create_time: ${ad.create_time}`);
    console.log(`  modify_time: ${ad.modify_time}`);

    // creative_listの詳細
    const creativeList = ad.creative_list || [];
    console.log(`\n  creative_list (${creativeList.length} items):`);
    for (let i = 0; i < creativeList.length; i++) {
      const c = creativeList[i];
      console.log(`    [${i}]:`);
      console.log(`      material_operation_status: ${c.material_operation_status}`);
      console.log(`      creative_info exists: ${c.creative_info ? 'yes' : 'no'}`);
      if (c.creative_info) {
        const ci = c.creative_info;
        console.log(`      material_name: ${ci.material_name}`);
        console.log(`      video_id: ${ci.video_info?.video_id || 'none'}`);
        console.log(`      image_info: ${ci.image_info ? JSON.stringify(ci.image_info).substring(0, 100) : 'none'}`);
      }
    }

    // 2. AdGroupの同期状況
    console.log('\n[Step 2] AdGroupの同期状況...');
    const adgroup = await prisma.adGroup.findUnique({
      where: { tiktokId: String(ad.adgroup_id) }
    });

    if (adgroup) {
      console.log(`  AdGroup in DB: ✓`);
      console.log(`    name: ${adgroup.name}`);
      console.log(`    createdAt: ${adgroup.createdAt.toISOString()}`);
      console.log(`    updatedAt: ${adgroup.updatedAt.toISOString()}`);
    } else {
      console.log(`  AdGroup in DB: ✗ NOT FOUND`);
    }

    // 3. Creativeの同期状況
    console.log('\n[Step 3] Creativeの同期状況...');
    const enabledCreative = creativeList.find(
      (c: any) => c.material_operation_status === 'ENABLE'
    );

    if (enabledCreative?.creative_info) {
      const ci = enabledCreative.creative_info;
      const videoId = ci.video_info?.video_id;

      if (videoId) {
        const creative = await prisma.creative.findFirst({
          where: { tiktokVideoId: videoId }
        });

        if (creative) {
          console.log(`  Creative (video) in DB: ✓`);
          console.log(`    id: ${creative.id}`);
          console.log(`    name: ${creative.name}`);
          console.log(`    createdAt: ${creative.createdAt.toISOString()}`);
        } else {
          console.log(`  Creative (video) in DB: ✗ NOT FOUND`);
          console.log(`    video_id: ${videoId}`);
        }
      }
    }

    // 4. 広告名に含まれる日付（作成日）の分析
    console.log('\n[Step 4] 広告作成タイミングの分析...');
    const dateMatch = ad.ad_name?.match(/^(\d{6})/);
    if (dateMatch) {
      const dateStr = dateMatch[1];
      const year = 2000 + parseInt(dateStr.substring(0, 2), 10);
      const month = parseInt(dateStr.substring(2, 4), 10);
      const day = parseInt(dateStr.substring(4, 6), 10);
      const adCreationDate = new Date(year, month - 1, day);

      console.log(`  広告名から推測した作成日: ${adCreationDate.toISOString().split('T')[0]}`);
      console.log(`  TikTok API create_time: ${ad.create_time}`);

      // 同期タイミング
      const nextSyncTime = new Date(adCreationDate);
      nextSyncTime.setDate(nextSyncTime.getDate() + 1);
      nextSyncTime.setHours(0, 0, 0, 0);
      console.log(`  次の同期ジョブ（予想）: ${nextSyncTime.toISOString()} (JST 0:00)`);
    }

    // 5. 同じAdGroupの他の広告の同期状況
    console.log('\n[Step 5] 同じAdGroupの他の広告を確認...');
    const sameAdgroupAds = await prisma.ad.findMany({
      where: {
        adGroup: {
          tiktokId: String(ad.adgroup_id)
        }
      }
    });

    console.log(`  同じAdGroup内の広告数: ${sameAdgroupAds.length}`);
    for (const a of sameAdgroupAds) {
      console.log(`    - ${a.name} (tiktokId: ${a.tiktokId})`);
      console.log(`      createdAt: ${a.createdAt.toISOString()}`);
    }

    // 6. 通常のad/get APIで同じ広告が返されるか確認
    console.log('\n[Step 6] 通常のad/get APIで確認...');
    const regularAdResponse = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/ad/get/`, {
      headers: {
        'Access-Token': token.accessToken,
        'Content-Type': 'application/json',
      },
      params: {
        advertiser_id: ADVERTISER_ID,
        filtering: JSON.stringify({
          adgroup_ids: [ad.adgroup_id],
        }),
        page_size: 100,
      },
    });

    if (regularAdResponse.data.code === 0 && regularAdResponse.data.data?.list) {
      const regularAds = regularAdResponse.data.data.list;
      console.log(`  ad/get で取得した広告数: ${regularAds.length}`);
      for (const ra of regularAds) {
        console.log(`    - ad_id: ${ra.ad_id}, name: ${ra.ad_name}`);

        // これがDBに存在するか
        const dbAd = await prisma.ad.findUnique({
          where: { tiktokId: String(ra.ad_id) }
        });
        console.log(`      DB: ${dbAd ? `✓ (name: ${dbAd.name})` : '✗'}`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
