import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api';
const ADVERTISER_ID = '7247073333517238273';

async function main() {
  console.log('='.repeat(80));
  console.log('Smart+ 広告の手動同期');
  console.log('='.repeat(80));

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: ADVERTISER_ID }
  });

  if (!token) {
    console.log('Token not found');
    return;
  }

  // Advertiserを取得
  const advertiser = await prisma.advertiser.findFirst({
    where: { tiktokAdvertiserId: ADVERTISER_ID }
  });

  if (!advertiser) {
    console.log('Advertiser not found');
    return;
  }

  console.log(`Advertiser: ${advertiser.name} (${advertiser.id})`);

  // Smart+ 広告をAPIから取得
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

  // 各Smart+ 広告を同期
  console.log('\n[Step 2] 各Smart+ 広告を同期...');
  let syncedCount = 0;
  let skippedCount = 0;

  for (const ad of smartPlusAds) {
    const adId = ad.smart_plus_ad_id || ad.ad_id;
    if (!adId) {
      console.log(`  スキップ: IDなし`);
      skippedCount++;
      continue;
    }

    // 既にDBに存在するか確認
    const existingAd = await prisma.ad.findUnique({
      where: { tiktokId: String(adId) }
    });

    if (existingAd) {
      console.log(`  既存: ${ad.ad_name} (${adId})`);
      continue;
    }

    // AdGroupを探す
    if (!ad.adgroup_id) {
      console.log(`  スキップ: adgroup_idなし - ${ad.ad_name}`);
      skippedCount++;
      continue;
    }

    const adgroup = await prisma.adGroup.findUnique({
      where: { tiktokId: String(ad.adgroup_id) },
    });

    if (!adgroup) {
      console.log(`  スキップ: AdGroup見つからない (${ad.adgroup_id}) - ${ad.ad_name}`);
      skippedCount++;
      continue;
    }

    // Creativeを処理
    let creativeId: string | null = null;
    const creativeList = ad.creative_list || [];
    const enabledCreative = creativeList.find(
      (c: any) => c.material_operation_status === 'ENABLE'
    );

    if (enabledCreative?.creative_info) {
      const creativeInfo = enabledCreative.creative_info;
      const videoId = creativeInfo.video_info?.video_id;
      const imageInfo = creativeInfo.image_info;

      if (videoId) {
        let creative = await prisma.creative.findFirst({
          where: { tiktokVideoId: videoId },
        });

        if (!creative) {
          creative = await prisma.creative.create({
            data: {
              advertiserId: advertiser.id,
              name: creativeInfo.material_name || `Video ${videoId}`,
              type: 'VIDEO',
              tiktokVideoId: videoId,
              url: videoId || '',
              filename: `video_${videoId}`,
            },
          });
          console.log(`    新規Creative作成: ${creative.id}`);
        }
        creativeId = creative.id;
      } else if (imageInfo && imageInfo.length > 0) {
        const imageId = imageInfo[0].web_uri || imageInfo[0].image_id;

        if (imageId) {
          let creative = await prisma.creative.findFirst({
            where: { tiktokImageId: imageId },
          });

          if (!creative) {
            creative = await prisma.creative.create({
              data: {
                advertiserId: advertiser.id,
                name: creativeInfo.material_name || `Image ${imageId}`,
                type: 'IMAGE',
                tiktokImageId: imageId,
                url: imageId || '',
                filename: `image_${imageId}`,
              },
            });
            console.log(`    新規Creative作成: ${creative.id}`);
          }
          creativeId = creative.id;
        }
      }
    }

    if (!creativeId) {
      console.log(`  スキップ: Creative見つからない - ${ad.ad_name}`);
      skippedCount++;
      continue;
    }

    // Smart+ Adを作成
    try {
      await prisma.ad.create({
        data: {
          tiktokId: String(adId),
          adgroupId: adgroup.id,
          name: ad.ad_name,
          creativeId,
          adText: ad.ad_text_list?.[0]?.ad_text,
          callToAction: ad.ad_configuration?.call_to_action_id,
          landingPageUrl: ad.landing_page_url_list?.[0]?.landing_page_url,
          displayName: enabledCreative?.creative_info?.identity_id,
          status: ad.operation_status,
          reviewStatus: 'APPROVED',
        },
      });
      console.log(`  ✓ 同期成功: ${ad.ad_name} (${adId})`);
      syncedCount++;
    } catch (error: any) {
      console.log(`  ✗ 同期失敗: ${ad.ad_name} - ${error.message}`);
      skippedCount++;
    }
  }

  console.log(`\n同期完了: ${syncedCount} 件同期, ${skippedCount} 件スキップ`);

  // 同期結果を確認
  console.log('\n[Step 3] 問題の広告を確認...');
  const targetAdId = '1849941219656738';
  const targetAd = await prisma.ad.findUnique({
    where: { tiktokId: targetAdId },
    include: {
      adGroup: true,
    }
  });

  if (targetAd) {
    console.log('✓ 問題の広告がDBに同期されました');
    console.log(`  DB ID: ${targetAd.id}`);
    console.log(`  名前: ${targetAd.name}`);
    console.log(`  AdGroup bidType: ${targetAd.adGroup?.bidType}`);

    // メトリクスがあるか確認
    const metrics = await prisma.metric.findMany({
      where: {
        adId: targetAd.id,
      },
      orderBy: { statDate: 'desc' },
      take: 5,
    });

    console.log(`\n  メトリクス数: ${metrics.length}`);
    if (metrics.length > 0) {
      let totalSpend = 0;
      for (const m of metrics) {
        totalSpend += m.spend;
        console.log(`    ${m.statDate.toISOString().split('T')[0]}: spend=${m.spend}`);
      }
      console.log(`  合計支出: ${totalSpend}円`);
    }
  } else {
    console.log('✗ 問題の広告がまだDBにありません');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
