import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api';
const ADVERTISER_ID = '7247073333517238273';

async function main() {
  console.log('='.repeat(80));
  console.log('Smart+ 広告同期失敗の原因調査');
  console.log('='.repeat(80));

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: ADVERTISER_ID }
  });

  if (!token) {
    console.log('Token not found');
    return;
  }

  const advertiser = await prisma.advertiser.findFirst({
    where: { tiktokAdvertiserId: ADVERTISER_ID }
  });

  if (!advertiser) {
    console.log('Advertiser not found');
    return;
  }

  console.log(`\nAdvertiser: ${advertiser.name} (${advertiser.id})`);

  // 1. Smart+ 広告をAPIから全件取得
  console.log('\n[Step 1] Smart+ ad/get APIから全広告を取得...');
  let smartPlusAds: any[] = [];

  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/ad/get/`, {
      headers: {
        'Access-Token': token.accessToken,
        'Content-Type': 'application/json',
      },
      params: {
        advertiser_id: ADVERTISER_ID,
        page_size: 100,
        page: page,
      },
    });

    if (response.data.code === 0 && response.data.data?.list) {
      smartPlusAds = smartPlusAds.concat(response.data.data.list);
      const pageInfo = response.data.data.page_info;
      if (pageInfo && pageInfo.page * pageInfo.page_size < pageInfo.total_number) {
        page++;
      } else {
        hasMore = false;
      }
    } else {
      hasMore = false;
    }
  }

  console.log(`Smart+ 広告数（API）: ${smartPlusAds.length}`);

  // 2. DBに存在するSmart+ 広告を確認
  console.log('\n[Step 2] DBに同期されているSmart+ 広告を確認...');

  let syncedCount = 0;
  let notSyncedCount = 0;
  const notSyncedAds: any[] = [];

  for (const ad of smartPlusAds) {
    const adId = ad.smart_plus_ad_id || ad.ad_id;
    const dbAd = await prisma.ad.findUnique({
      where: { tiktokId: String(adId) }
    });

    if (dbAd) {
      syncedCount++;
    } else {
      notSyncedCount++;
      notSyncedAds.push(ad);
    }
  }

  console.log(`同期済み: ${syncedCount} 件`);
  console.log(`未同期: ${notSyncedCount} 件`);

  // 3. 未同期の広告について詳細を調査
  if (notSyncedAds.length > 0) {
    console.log('\n[Step 3] 未同期広告の詳細調査...');

    for (const ad of notSyncedAds) {
      const adId = ad.smart_plus_ad_id || ad.ad_id;
      console.log(`\n--- ${ad.ad_name} (${adId}) ---`);
      console.log(`  operation_status: ${ad.operation_status}`);
      console.log(`  adgroup_id: ${ad.adgroup_id}`);
      console.log(`  campaign_id: ${ad.campaign_id}`);

      // AdGroupがDBに存在するか
      const adgroup = ad.adgroup_id ? await prisma.adGroup.findUnique({
        where: { tiktokId: String(ad.adgroup_id) }
      }) : null;
      console.log(`  AdGroup in DB: ${adgroup ? `✓ (${adgroup.name})` : '✗ NOT FOUND'}`);

      // creative_list の状態
      const creativeList = ad.creative_list || [];
      console.log(`  creative_list length: ${creativeList.length}`);

      const enabledCreative = creativeList.find(
        (c: any) => c.material_operation_status === 'ENABLE'
      );
      console.log(`  enabledCreative: ${enabledCreative ? 'found' : 'NOT FOUND'}`);

      if (enabledCreative?.creative_info) {
        const ci = enabledCreative.creative_info;
        const videoId = ci.video_info?.video_id;
        const imageInfo = ci.image_info;

        console.log(`  video_id: ${videoId || 'none'}`);
        console.log(`  image_info: ${imageInfo && imageInfo.length > 0 ? 'exists' : 'none'}`);

        // Creativeの存在確認
        if (videoId) {
          const creative = await prisma.creative.findFirst({
            where: { tiktokVideoId: videoId }
          });
          console.log(`  Creative in DB (video): ${creative ? `✓ (${creative.id})` : '✗ NOT FOUND'}`);
        } else if (imageInfo && imageInfo.length > 0) {
          const imageId = imageInfo[0].web_uri || imageInfo[0].image_id;
          if (imageId) {
            const creative = await prisma.creative.findFirst({
              where: { tiktokImageId: imageId }
            });
            console.log(`  Creative in DB (image): ${creative ? `✓ (${creative.id})` : '✗ NOT FOUND'}`);
          }
        }
      } else {
        console.log(`  creative_info: NOT FOUND`);

        // creative_listの中身を詳細に確認
        if (creativeList.length > 0) {
          console.log(`  creative_list details:`);
          for (let i = 0; i < creativeList.length; i++) {
            const c = creativeList[i];
            console.log(`    [${i}] material_operation_status: ${c.material_operation_status}`);
            console.log(`        creative_info exists: ${c.creative_info ? 'yes' : 'NO'}`);
          }
        }
      }
    }
  }

  // 4. 同期済み広告の作成日時を確認
  console.log('\n[Step 4] DBに同期されているSmart+広告のタイムスタンプを確認...');

  for (const ad of smartPlusAds) {
    const adId = ad.smart_plus_ad_id || ad.ad_id;
    const dbAd = await prisma.ad.findUnique({
      where: { tiktokId: String(adId) }
    });

    if (dbAd) {
      console.log(`  ${ad.ad_name}`);
      console.log(`    createdAt: ${dbAd.createdAt.toISOString()}`);
      console.log(`    updatedAt: ${dbAd.updatedAt.toISOString()}`);
    }
  }

  // 5. 広告の作成日（広告名から推測）と同期タイミングの関係
  console.log('\n[Step 5] 広告作成日と同期タイミングの分析...');

  for (const ad of notSyncedAds) {
    const adName = ad.ad_name || '';
    const dateMatch = adName.match(/^(\d{6})/);
    if (dateMatch) {
      const dateStr = dateMatch[1];
      const year = 2000 + parseInt(dateStr.substring(0, 2), 10);
      const month = parseInt(dateStr.substring(2, 4), 10);
      const day = parseInt(dateStr.substring(4, 6), 10);
      const adDate = new Date(year, month - 1, day);

      console.log(`  ${adName}`);
      console.log(`    広告作成日（推測）: ${adDate.toISOString().split('T')[0]}`);
      console.log(`    同期されるべきだった日: ${new Date(adDate.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]} 0:00 JST`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
