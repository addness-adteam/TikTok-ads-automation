import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

/**
 * 支出が0になる問題の広告を調査
 * 対象広告:
 * - 1849925125797105: 251128/清水絢吾/箕輪さん→3兆円企業/LP1-CR00671
 * - 1849940699726881: 251128/清水絢吾/ピザ→問題ないです（ChatGPT）/LP1-CR00672
 * - 1850253042082962: 251201/高橋海斗/配達員/冒頭4/LP1-CR00678
 */
async function investigateSpendZeroAds() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  // 調査対象の広告ID（広告マネージャー上のad_id）
  const targetAdIds = [
    { adId: '1849925125797105', name: '251128/清水絢吾/箕輪さん→3兆円企業/LP1-CR00671' },
    { adId: '1849940699726881', name: '251128/清水絢吾/ピザ→問題ないです（ChatGPT）/LP1-CR00672' },
    { adId: '1850253042082962', name: '251201/高橋海斗/配達員/冒頭4/LP1-CR00678' },
  ];

  console.log('========================================');
  console.log('支出0問題の広告調査');
  console.log('========================================\n');

  try {
    // AI1のAdvertiserを取得
    const advertisers = await prisma.advertiser.findMany({
      where: {
        name: { contains: 'AI' }
      },
      include: { appeal: true }
    });

    console.log('【0】登録されているAdvertiser:');
    for (const adv of advertisers) {
      console.log(`  - ${adv.name} (${adv.tiktokAdvertiserId}) - Appeal: ${adv.appeal?.name || 'なし'}`);
    }
    console.log('');

    // AI1のOAuthトークンを取得
    const ai1AdvertiserId = '7468288053866561553'; // AI_1
    const oauthToken = await prisma.oAuthToken.findFirst({
      where: {
        advertiserId: ai1AdvertiserId,
        expiresAt: { gt: new Date() }
      }
    });

    if (!oauthToken) {
      console.log(`AI1 (${ai1AdvertiserId}) の有効なOAuthトークンが見つかりません`);
      // 他のトークンで試す
      const anyToken = await prisma.oAuthToken.findFirst({
        where: { expiresAt: { gt: new Date() } }
      });
      if (anyToken) {
        console.log(`代わりに ${anyToken.advertiserId} のトークンを使用`);
      }
      await app.close();
      return;
    }

    console.log(`使用するAdvertiser: ${oauthToken.advertiserId} (AI_1)\n`);

    for (const target of targetAdIds) {
      console.log('========================================');
      console.log(`【調査】${target.name}`);
      console.log(`広告マネージャー上のad_id: ${target.adId}`);
      console.log('========================================\n');

      // 1. DBでad_idで検索
      console.log('【1】DBでad_idで検索:');
      const adByAdId = await prisma.ad.findUnique({
        where: { tiktokId: target.adId },
        include: {
          adGroup: {
            include: {
              campaign: true
            }
          }
        }
      });

      if (adByAdId) {
        console.log(`  ✓ 見つかりました`);
        console.log(`    DB ID: ${adByAdId.id}`);
        console.log(`    tiktokId: ${adByAdId.tiktokId}`);
        console.log(`    name: ${adByAdId.name}`);
        console.log(`    status: ${adByAdId.status}`);
        console.log(`    bidType: ${adByAdId.adGroup.bidType}`);
        console.log(`    campaign: ${adByAdId.adGroup.campaign.name}`);
      } else {
        console.log(`  ✗ 見つかりませんでした（ad_idでは登録されていない）`);
      }
      console.log('');

      // 2. TikTok APIで広告情報を取得
      console.log('【2】TikTok APIで広告情報を取得:');
      try {
        const adsResponse = await tiktokService.getAds(oauthToken.advertiserId, oauthToken.accessToken);
        const adFromApi = adsResponse.data?.list?.find((ad: any) =>
          String(ad.ad_id) === target.adId || String(ad.smart_plus_ad_id) === target.adId
        );

        if (adFromApi) {
          console.log(`  ✓ APIから取得できました`);
          console.log(`    ad_id: ${adFromApi.ad_id}`);
          console.log(`    smart_plus_ad_id: ${adFromApi.smart_plus_ad_id || 'なし'}`);
          console.log(`    ad_name: ${adFromApi.ad_name}`);
          console.log(`    operation_status: ${adFromApi.operation_status}`);
          console.log(`    campaign_id: ${adFromApi.campaign_id}`);
          console.log(`    adgroup_id: ${adFromApi.adgroup_id}`);

          // Smart+広告の場合、smart_plus_ad_idでDBを検索
          if (adFromApi.smart_plus_ad_id) {
            console.log('');
            console.log('【3】Smart+広告のため、smart_plus_ad_idでDB検索:');
            const adBySmartPlusId = await prisma.ad.findUnique({
              where: { tiktokId: String(adFromApi.smart_plus_ad_id) },
              include: {
                adGroup: {
                  include: {
                    campaign: true
                  }
                }
              }
            });

            if (adBySmartPlusId) {
              console.log(`  ✓ 見つかりました`);
              console.log(`    DB ID: ${adBySmartPlusId.id}`);
              console.log(`    tiktokId: ${adBySmartPlusId.tiktokId}`);
              console.log(`    name: ${adBySmartPlusId.name}`);
              console.log(`    bidType: ${adBySmartPlusId.adGroup.bidType}`);

              // メトリクスを確認
              console.log('');
              console.log('【4】この広告のメトリクス:');
              const metrics = await prisma.metric.findMany({
                where: { adId: adBySmartPlusId.id },
                orderBy: { statDate: 'desc' },
                take: 10
              });

              if (metrics.length > 0) {
                console.log(`  ✓ ${metrics.length}件のメトリクスが見つかりました`);
                for (const m of metrics) {
                  console.log(`    ${m.statDate.toISOString().split('T')[0]}: spend=¥${m.spend}, imp=${m.impressions}, clicks=${m.clicks}`);
                }
              } else {
                console.log(`  ✗ メトリクスが見つかりませんでした`);
              }

              // 過去7日間のメトリクス合計
              const now = new Date();
              const jstOffset = 9 * 60 * 60 * 1000;
              const jstNow = new Date(now.getTime() + jstOffset);
              const endDate = new Date(jstNow);
              endDate.setUTCDate(endDate.getUTCDate() - 1);
              endDate.setUTCHours(23, 59, 59, 999);
              const startDate = new Date(endDate);
              startDate.setUTCDate(startDate.getUTCDate() - 6);
              startDate.setUTCHours(0, 0, 0, 0);

              console.log('');
              console.log(`【5】過去7日間のメトリクス (${startDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]}):`);
              const recentMetrics = await prisma.metric.findMany({
                where: {
                  adId: adBySmartPlusId.id,
                  statDate: {
                    gte: startDate,
                    lte: endDate
                  }
                }
              });

              if (recentMetrics.length > 0) {
                const totalSpend = recentMetrics.reduce((sum, m) => sum + m.spend, 0);
                const totalImpressions = recentMetrics.reduce((sum, m) => sum + m.impressions, 0);
                console.log(`  ✓ ${recentMetrics.length}件`);
                console.log(`    合計: spend=¥${totalSpend}, imp=${totalImpressions}`);
              } else {
                console.log(`  ✗ この期間のメトリクスがありません`);
              }
            } else {
              console.log(`  ✗ smart_plus_ad_idでも見つかりませんでした`);
            }
          }
        } else {
          console.log(`  ✗ APIから取得できませんでした`);
        }
      } catch (error: any) {
        console.log(`  ✗ APIエラー: ${error.message}`);
      }

      // Smart+ APIでも確認
      console.log('');
      console.log('【6】Smart+ Ad APIで確認:');
      try {
        const smartPlusResponse = await tiktokService.getSmartPlusAds(oauthToken.advertiserId, oauthToken.accessToken);
        const smartPlusAd = smartPlusResponse.data?.list?.find((ad: any) =>
          String(ad.ad_id) === target.adId || String(ad.smart_plus_ad_id) === target.adId
        );

        if (smartPlusAd) {
          console.log(`  ✓ Smart+ APIから取得できました`);
          console.log(`    ad_id: ${smartPlusAd.ad_id}`);
          console.log(`    smart_plus_ad_id: ${smartPlusAd.smart_plus_ad_id}`);
          console.log(`    ad_name: ${smartPlusAd.ad_name}`);
          console.log(`    operation_status: ${smartPlusAd.operation_status}`);
        } else {
          console.log(`  ✗ Smart+ APIでは見つかりませんでした`);
        }
      } catch (error: any) {
        console.log(`  ✗ Smart+ APIエラー: ${error.message}`);
      }

      console.log('\n');
    }

    // 全体のメトリクス状況を確認
    console.log('========================================');
    console.log('【全体】直近のメトリクス同期状況');
    console.log('========================================\n');

    const latestMetrics = await prisma.metric.findMany({
      where: { entityType: 'AD' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        ad: true
      }
    });

    console.log('最新の広告メトリクス（5件）:');
    for (const m of latestMetrics) {
      console.log(`  ${m.statDate.toISOString().split('T')[0]} | ${m.ad?.name?.substring(0, 40) || 'N/A'} | spend=¥${m.spend} | 作成: ${m.createdAt.toISOString()}`);
    }

  } catch (error: any) {
    console.error(`エラー: ${error.message}`);
    console.error(error.stack);
  } finally {
    await app.close();
  }
}

investigateSpendZeroAds();
