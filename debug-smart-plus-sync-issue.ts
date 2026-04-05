import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api';
const ADVERTISER_ID = '7247073333517238273';

async function main() {
  console.log('='.repeat(80));
  console.log('Smart+ 広告同期問題の調査');
  console.log('='.repeat(80));

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: ADVERTISER_ID }
  });

  if (!token) {
    console.log('Token not found');
    return;
  }

  // 1. Smart+ 広告をAPIから取得
  console.log('\n[Step 1] Smart+ ad/get APIから広告を取得...');
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

  console.log(`Smart+ 広告数: ${smartPlusAds.length}`);

  // 2. 問題の広告を特定
  console.log('\n[Step 2] 問題の広告の詳細を確認...');
  const targetAd = smartPlusAds.find(ad =>
    ad.ad_name?.includes('251128') && ad.ad_name?.includes('CR00586')
  );

  if (targetAd) {
    console.log('問題の広告:');
    console.log(`  ad_name: ${targetAd.ad_name}`);
    console.log(`  smart_plus_ad_id: ${targetAd.smart_plus_ad_id}`);
    console.log(`  ad_id: ${targetAd.ad_id || 'なし'}`);
    console.log(`  adgroup_id: ${targetAd.adgroup_id}`);
    console.log(`  campaign_id: ${targetAd.campaign_id}`);
    console.log(`  operation_status: ${targetAd.operation_status}`);

    // creative_list を確認
    console.log(`\n  creative_list の確認:`);
    const creativeList = targetAd.creative_list || [];
    console.log(`    クリエイティブ数: ${creativeList.length}`);

    for (let i = 0; i < creativeList.length; i++) {
      const c = creativeList[i];
      console.log(`\n    [${i}] material_operation_status: ${c.material_operation_status}`);
      const creativeInfo = c.creative_info;
      if (creativeInfo) {
        console.log(`        material_name: ${creativeInfo.material_name}`);
        const videoInfo = creativeInfo.video_info;
        const imageInfo = creativeInfo.image_info;

        if (videoInfo) {
          console.log(`        video_id: ${videoInfo.video_id}`);
        }
        if (imageInfo && imageInfo.length > 0) {
          console.log(`        image_info[0].web_uri: ${imageInfo[0].web_uri}`);
          console.log(`        image_info[0].image_id: ${imageInfo[0].image_id}`);
        }
      } else {
        console.log(`        creative_info: null`);
      }
    }

    // DBに存在するか確認
    console.log(`\n[Step 3] DBに同期されているか確認...`);
    const adId = targetAd.smart_plus_ad_id || targetAd.ad_id;
    const dbAd = await prisma.ad.findUnique({
      where: { tiktokId: String(adId) }
    });

    if (dbAd) {
      console.log('✓ DBに存在');
      console.log(`  DB ID: ${dbAd.id}`);
      console.log(`  DB name: ${dbAd.name}`);
    } else {
      console.log('✗ DBに未同期');

      // 同期処理のシミュレーション
      console.log('\n[Step 4] 同期処理のシミュレーション...');

      // AdGroupを検索
      const adgroup = await prisma.adGroup.findUnique({
        where: { tiktokId: String(targetAd.adgroup_id) },
        include: { campaign: { include: { advertiser: true } } }
      });

      if (adgroup) {
        console.log(`  AdGroup見つかった: ${adgroup.name}`);

        // Creativeを処理
        let creativeId: string | null = null;
        const enabledCreative = creativeList.find(
          (c: any) => c.material_operation_status === 'ENABLE'
        );

        console.log(`  enabledCreative: ${enabledCreative ? 'あり' : 'なし'}`);

        if (enabledCreative?.creative_info) {
          const creativeInfo = enabledCreative.creative_info;
          const videoId = creativeInfo.video_info?.video_id;
          const imageInfo = creativeInfo.image_info;

          console.log(`  videoId: ${videoId || 'なし'}`);
          console.log(`  imageInfo: ${imageInfo ? JSON.stringify(imageInfo).substring(0, 200) : 'なし'}`);

          if (videoId) {
            const creative = await prisma.creative.findFirst({
              where: { tiktokVideoId: videoId },
            });
            console.log(`  既存Creative(video): ${creative ? creative.id : 'なし'}`);
            creativeId = creative?.id || null;
          } else if (imageInfo && imageInfo.length > 0) {
            const imageId = imageInfo[0].web_uri || imageInfo[0].image_id;
            console.log(`  imageId: ${imageId}`);

            if (imageId) {
              const creative = await prisma.creative.findFirst({
                where: { tiktokImageId: imageId },
              });
              console.log(`  既存Creative(image): ${creative ? creative.id : 'なし'}`);
              creativeId = creative?.id || null;
            }
          }
        }

        console.log(`\n  最終的なcreativeId: ${creativeId || 'なし'}`);

        if (!creativeId) {
          console.log('\n  *** 問題の原因特定: Creative が見つからないためスキップされている ***');
        }
      } else {
        console.log('  AdGroupが見つからない');
      }
    }
  } else {
    console.log('問題の広告が見つかりませんでした');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
