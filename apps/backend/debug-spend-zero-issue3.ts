/**
 * 支出が0になる問題の根本原因調査
 * 1. Smart+広告の同期状況を確認
 * 2. メトリクス同期の状況を確認
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  console.log('========================================');
  console.log('支出0問題の根本原因調査');
  console.log('========================================\n');

  try {
    // 1. AI_1アカウントを取得
    const advertiser = await prisma.advertiser.findFirst({
      where: {
        OR: [
          { name: { contains: 'AI_1' } },
          { name: { contains: 'AI1' } },
        ]
      },
    });

    if (!advertiser) {
      console.log('❌ AI_1アカウントが見つかりません');
      await app.close();
      return;
    }

    console.log(`✓ Advertiser: ${advertiser.name}`);
    console.log(`  TikTok ID: ${advertiser.tiktokAdvertiserId}`);
    console.log(`  Internal ID: ${advertiser.id}\n`);

    const token = await prisma.oAuthToken.findFirst({
      where: {
        advertiserId: advertiser.tiktokAdvertiserId,
        expiresAt: { gt: new Date() }
      }
    });

    if (!token) {
      console.log('❌ 有効なアクセストークンがありません');
      await app.close();
      return;
    }

    // 2. APIから広告を取得
    console.log('========================================');
    console.log('Step 1: Smart+ API vs DB 比較');
    console.log('========================================');

    const smartPlusResponse = await tiktokService.getSmartPlusAds(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );

    const apiSmartPlusAds = smartPlusResponse.data?.list || [];
    console.log(`\nSmart+ API: ${apiSmartPlusAds.length}件`);

    // DBのAdsを取得
    const dbAds = await prisma.ad.findMany({
      where: {
        adGroup: {
          campaign: {
            advertiserId: advertiser.id
          }
        }
      },
      include: {
        adGroup: true
      }
    });
    console.log(`DB Ads: ${dbAds.length}件`);

    // APIの広告IDとDBの広告IDを比較
    const apiAdIds = new Set(apiSmartPlusAds.map((ad: any) => ad.smart_plus_ad_id));
    const dbAdIds = new Set(dbAds.map(ad => ad.tiktokId));

    const onlyInApi = [...apiAdIds].filter(id => !dbAdIds.has(id as string));
    const onlyInDb = [...dbAdIds].filter(id => !apiAdIds.has(id as string));
    const inBoth = [...apiAdIds].filter(id => dbAdIds.has(id as string));

    console.log(`\n一致確認:`);
    console.log(`  - APIにのみ存在: ${onlyInApi.length}件`);
    console.log(`  - DBにのみ存在: ${onlyInDb.length}件`);
    console.log(`  - 両方に存在: ${inBoth.length}件`);

    // 対象広告がどちらにあるか確認
    console.log('\n========================================');
    console.log('Step 2: 対象広告（CR00666）の確認');
    console.log('========================================');

    const targetApiAd = apiSmartPlusAds.find((ad: any) =>
      ad.ad_name && ad.ad_name.includes('CR00666')
    );

    if (targetApiAd) {
      console.log(`\n✓ APIに存在:`);
      console.log(`  Smart+ Ad ID: ${targetApiAd.smart_plus_ad_id}`);
      console.log(`  Ad Name: ${targetApiAd.ad_name}`);
      console.log(`  Campaign ID: ${targetApiAd.campaign_id}`);
      console.log(`  AdGroup ID: ${targetApiAd.adgroup_id}`);

      // このad_idがDBに存在するか確認
      const dbTargetAd = dbAds.find(ad => ad.tiktokId === targetApiAd.smart_plus_ad_id);
      if (dbTargetAd) {
        console.log(`\n✓ DBにも存在:`);
        console.log(`  DB Ad ID: ${dbTargetAd.id}`);
        console.log(`  TikTok ID: ${dbTargetAd.tiktokId}`);
        console.log(`  Name: ${dbTargetAd.name}`);
      } else {
        console.log(`\n❌ DBには存在しません！`);

        // AdGroupが存在するか確認
        const adGroup = await prisma.adGroup.findUnique({
          where: { tiktokId: String(targetApiAd.adgroup_id) }
        });

        if (adGroup) {
          console.log(`\n✓ AdGroupはDBに存在: ${adGroup.id}`);
        } else {
          console.log(`\n❌ AdGroupもDBに存在しません！`);
          console.log(`  AdGroup TikTok ID: ${targetApiAd.adgroup_id}`);

          // Campaignが存在するか確認
          const campaign = await prisma.campaign.findUnique({
            where: { tiktokId: String(targetApiAd.campaign_id) }
          });

          if (campaign) {
            console.log(`\n✓ CampaignはDBに存在: ${campaign.id}`);
          } else {
            console.log(`\n❌ CampaignもDBに存在しません！`);
            console.log(`  Campaign TikTok ID: ${targetApiAd.campaign_id}`);
          }
        }
      }
    } else {
      console.log('⚠️ 対象広告がSmart+ APIに存在しません');
    }

    // 3. spend > 0 のメトリクスを確認
    console.log('\n========================================');
    console.log('Step 3: spend > 0 のメトリクス確認');
    console.log('========================================');

    const metricsWithSpend = await prisma.metric.findMany({
      where: {
        spend: { gt: 0 },
        ad: {
          adGroup: {
            campaign: {
              advertiserId: advertiser.id
            }
          }
        }
      },
      orderBy: { statDate: 'desc' },
      take: 10,
      include: {
        ad: true
      }
    });

    console.log(`\nspend > 0 のメトリクス（最新10件）: ${metricsWithSpend.length}件`);
    if (metricsWithSpend.length > 0) {
      metricsWithSpend.forEach((m, i) => {
        console.log(`  [${i + 1}] ${m.statDate.toISOString().split('T')[0]} - ${m.ad?.name?.substring(0, 40)} - spend: ${m.spend}`);
      });
    } else {
      console.log('  ⚠️ すべてのメトリクスでspend=0です！');
    }

    // 4. 最新のメトリクスで実際にspendがあるものを確認
    console.log('\n========================================');
    console.log('Step 4: Smart+ Metrics APIの直接確認');
    console.log('========================================');

    // 過去7日間の日付（TikTok APIの正しいフォーマットYYYY-MM-DD）
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    console.log(`\n期間: ${startDateStr} ~ ${endDateStr}`);

    try {
      const metricsResponse = await tiktokService.getAllSmartPlusAdMetrics(
        advertiser.tiktokAdvertiserId,
        token.accessToken,
        {
          startDate: startDateStr,
          endDate: endDateStr,
        }
      );

      console.log(`\nSmart+ Metrics API: ${metricsResponse.length}件取得`);

      if (metricsResponse.length > 0) {
        // spendがあるものを確認
        const withSpend = metricsResponse.filter((m: any) =>
          parseFloat(m.metrics?.spend || '0') > 0
        );
        console.log(`  spend > 0: ${withSpend.length}件`);

        // サンプルデータを表示
        console.log(`\n  サンプル（最初の5件）:`);
        metricsResponse.slice(0, 5).forEach((m: any, i: number) => {
          const smartPlusAdId = m.dimensions?.smart_plus_ad_id;
          const spend = m.metrics?.spend || '0';
          const impressions = m.metrics?.impressions || '0';
          console.log(`    [${i + 1}] smart_plus_ad_id: ${smartPlusAdId}, imp: ${impressions}, spend: ${spend}`);
        });
      }
    } catch (error: any) {
      console.log(`\n❌ Smart+ Metrics API Error: ${error.message}`);

      // エラーの詳細を確認
      if (error.response?.data) {
        console.log(`API Response: ${JSON.stringify(error.response.data, null, 2)}`);
      }
    }

    // 5. 通常広告のメトリクスも確認
    console.log('\n========================================');
    console.log('Step 5: 通常広告レポートの確認');
    console.log('========================================');

    try {
      const reportData = await tiktokService.getAllReportData(
        advertiser.tiktokAdvertiserId,
        token.accessToken,
        {
          dataLevel: 'AUCTION_AD',
          startDate: startDateStr,
          endDate: endDateStr,
        }
      );

      console.log(`\n通常広告レポート: ${reportData.length}件取得`);

      if (reportData.length > 0) {
        // spendがあるものを確認
        const withSpend = reportData.filter((m: any) =>
          parseFloat(m.metrics?.spend || '0') > 0
        );
        console.log(`  spend > 0: ${withSpend.length}件`);

        // サンプルデータを表示
        console.log(`\n  サンプル（最初の5件）:`);
        reportData.slice(0, 5).forEach((m: any, i: number) => {
          const adId = m.dimensions?.ad_id;
          const spend = m.metrics?.spend || '0';
          const impressions = m.metrics?.impressions || '0';
          console.log(`    [${i + 1}] ad_id: ${adId}, imp: ${impressions}, spend: ${spend}`);
        });
      }
    } catch (error: any) {
      console.log(`\n❌ Report API Error: ${error.message}`);
    }

    console.log('\n========================================');
    console.log('結論');
    console.log('========================================');

    console.log(`
問題の原因候補:
1. Smart+広告がDBに同期されていない（APIにのみ存在: ${onlyInApi.length}件）
2. メトリクスの同期時にSmart+広告用のロジックに問題がある
3. 予算調整時のgetAdMetrics()でDBに広告が見つからずspend=0を返している
`);

  } catch (error: any) {
    console.error('❌ エラー:', error.message);
    console.error(error.stack);
  } finally {
    await app.close();
  }
}

main();
