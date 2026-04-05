/**
 * 支出が0になる問題の調査スクリプト
 * 対象広告：251126/清水絢吾/林社長→AI学ぶな②/LP1-CR00666
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
  console.log('支出0問題の調査');
  console.log('対象広告: 251126/清水絢吾/林社長→AI学ぶな②/LP1-CR00666');
  console.log('========================================\n');

  try {
    // 1. アドネス株式会社_AI_1を探す
    const advertiser = await prisma.advertiser.findFirst({
      where: {
        OR: [
          { name: { contains: 'AI_1' } },
          { name: { contains: 'AI1' } },
        ]
      },
      include: {
        appeal: true,
      }
    });

    if (!advertiser) {
      console.log('❌ AI_1アカウントが見つかりません');
      await app.close();
      return;
    }

    console.log(`✓ Advertiser: ${advertiser.name}`);
    console.log(`  TikTok ID: ${advertiser.tiktokAdvertiserId}\n`);

    // 2. アクセストークンを取得
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

    // 3. 対象広告を広告名で検索（DBから）
    console.log('========================================');
    console.log('Step 1: DBから広告を検索');
    console.log('========================================');

    // DBのAdテーブルから検索
    const dbAd = await prisma.ad.findFirst({
      where: {
        name: { contains: '清水絢吾' }
      },
      include: {
        adGroup: {
          include: {
            campaign: true
          }
        },
        metrics: {
          orderBy: { statDate: 'desc' },
          take: 10
        }
      }
    });

    if (dbAd) {
      console.log(`\n✓ DBで広告を発見:`);
      console.log(`  Ad ID (internal): ${dbAd.id}`);
      console.log(`  TikTok Ad ID: ${dbAd.tiktokId}`);
      console.log(`  Ad Name: ${dbAd.name}`);
      console.log(`  Status: ${dbAd.status}`);
      console.log(`  AdGroup ID: ${dbAd.adgroupId}`);
      console.log(`  AdGroup TikTok ID: ${dbAd.adGroup.tiktokId}`);
      console.log(`  Campaign ID: ${dbAd.adGroup.campaignId}`);
      console.log(`  Campaign TikTok ID: ${dbAd.adGroup.campaign.tiktokId}`);
      console.log(`  AdGroup bidType: ${dbAd.adGroup.bidType}`);

      console.log(`\n  Metrics (最新10件):`);
      if (dbAd.metrics.length === 0) {
        console.log('    ⚠️ メトリクスが0件です！');
      } else {
        dbAd.metrics.forEach((m, i) => {
          console.log(`    [${i + 1}] ${m.statDate.toISOString().split('T')[0]} - impressions: ${m.impressions}, clicks: ${m.clicks}, spend: ${m.spend}`);
        });
      }
    } else {
      console.log('⚠️ DBに該当する広告が見つかりません');
    }

    // 4. TikTok APIから直接広告を取得
    console.log('\n========================================');
    console.log('Step 2: TikTok APIから広告を取得');
    console.log('========================================');

    const adsResponse = await tiktokService.getAds(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );

    const allAds = adsResponse.data?.list || [];
    const targetAd = allAds.find((ad: any) =>
      ad.ad_name && ad.ad_name.includes('清水絢吾')
    );

    if (targetAd) {
      console.log(`\n✓ TikTok APIで広告を発見:`);
      console.log(`  Ad ID: ${targetAd.ad_id}`);
      console.log(`  Ad Name: ${targetAd.ad_name}`);
      console.log(`  Status: ${targetAd.operation_status}`);
      console.log(`  AdGroup ID: ${targetAd.adgroup_id}`);
      console.log(`  Campaign ID: ${targetAd.campaign_id}`);
    } else {
      console.log('⚠️ TikTok APIに該当する広告が見つかりません（通常広告）');
    }

    // 5. 新スマプラAPIからも確認
    console.log('\n========================================');
    console.log('Step 3: Smart+ APIから広告を取得');
    console.log('========================================');

    const smartPlusResponse = await tiktokService.getSmartPlusAds(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );

    const smartPlusAds = smartPlusResponse.data?.list || [];
    const targetSmartPlusAd = smartPlusAds.find((ad: any) =>
      ad.ad_name && ad.ad_name.includes('清水絢吾')
    );

    if (targetSmartPlusAd) {
      console.log(`\n✓ Smart+ APIで広告を発見:`);
      console.log(`  Smart+ Ad ID: ${targetSmartPlusAd.smart_plus_ad_id}`);
      console.log(`  Ad Name: ${targetSmartPlusAd.ad_name}`);
      console.log(`  Status: ${targetSmartPlusAd.operation_status}`);
      console.log(`  AdGroup ID: ${targetSmartPlusAd.adgroup_id}`);
      console.log(`  Campaign ID: ${targetSmartPlusAd.campaign_id}`);
    } else {
      console.log('⚠️ Smart+ APIに該当する広告が見つかりません');
    }

    // 6. メトリクス同期の状況を確認
    console.log('\n========================================');
    console.log('Step 4: 評価期間のメトリクス確認');
    console.log('========================================');

    // 過去7日間の期間を計算（当日は含めない）
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    const jstNow = new Date(now.getTime() + jstOffset);

    const endDate = new Date(jstNow);
    endDate.setUTCDate(endDate.getUTCDate() - 1);
    endDate.setUTCHours(23, 59, 59, 999);

    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 6);
    startDate.setUTCHours(0, 0, 0, 0);

    console.log(`\n評価期間: ${startDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]}`);

    if (dbAd) {
      const periodMetrics = await prisma.metric.findMany({
        where: {
          adId: dbAd.id,
          statDate: {
            gte: startDate,
            lte: endDate,
          }
        },
        orderBy: { statDate: 'asc' }
      });

      console.log(`\n期間内のメトリクス数: ${periodMetrics.length}`);

      if (periodMetrics.length > 0) {
        let totalSpend = 0;
        let totalImpressions = 0;
        periodMetrics.forEach((m, i) => {
          console.log(`  [${i + 1}] ${m.statDate.toISOString().split('T')[0]} - impressions: ${m.impressions}, spend: ${m.spend}`);
          totalSpend += m.spend;
          totalImpressions += m.impressions;
        });
        console.log(`\n  合計: impressions=${totalImpressions}, spend=${totalSpend}`);
      } else {
        console.log('  ⚠️ 評価期間内のメトリクスが0件です！');
      }

      // Smart+判定ロジックをシミュレート
      console.log('\n========================================');
      console.log('Step 5: Smart+判定ロジックの確認');
      console.log('========================================');

      const isSmartPlus = dbAd.adGroup.bidType === 'BID_TYPE_NO_BID';
      console.log(`\nbidType: ${dbAd.adGroup.bidType}`);
      console.log(`Smart+判定: ${isSmartPlus}`);

      if (isSmartPlus) {
        console.log('\n⚠️ Smart+広告として判定されています');
        console.log('→ 最新の1レコードのみを使用するロジックが適用されます');

        // 最新1件を取得
        const latestMetric = await prisma.metric.findMany({
          where: {
            adId: dbAd.id,
            statDate: {
              gte: startDate,
              lte: endDate,
            }
          },
          orderBy: { statDate: 'desc' },
          take: 1,
        });

        if (latestMetric.length > 0) {
          console.log(`\n最新メトリクス: ${latestMetric[0].statDate.toISOString().split('T')[0]}`);
          console.log(`  impressions: ${latestMetric[0].impressions}`);
          console.log(`  spend: ${latestMetric[0].spend}`);
        } else {
          console.log('\n❌ 最新メトリクスも0件です');
        }
      }
    }

    // 7. 全メトリクスの確認
    console.log('\n========================================');
    console.log('Step 6: DB全体のメトリクス状況');
    console.log('========================================');

    // AI_1アカウントの全メトリクスを確認
    const allMetricsCount = await prisma.metric.count({
      where: {
        ad: {
          adGroup: {
            campaign: {
              advertiser: {
                tiktokAdvertiserId: advertiser.tiktokAdvertiserId
              }
            }
          }
        }
      }
    });

    console.log(`\nAI_1アカウントの総メトリクス数: ${allMetricsCount}`);

    // 直近の日付のメトリクスを確認
    const recentMetrics = await prisma.metric.findMany({
      where: {
        ad: {
          adGroup: {
            campaign: {
              advertiser: {
                tiktokAdvertiserId: advertiser.tiktokAdvertiserId
              }
            }
          }
        }
      },
      orderBy: { statDate: 'desc' },
      take: 5,
      include: {
        ad: true
      }
    });

    console.log('\n直近のメトリクス（最新5件）:');
    recentMetrics.forEach((m, i) => {
      console.log(`  [${i + 1}] ${m.statDate.toISOString().split('T')[0]} - ${m.ad?.name?.substring(0, 40) || 'Unknown'} - spend: ${m.spend}`);
    });

    // 8. 広告IDの比較
    console.log('\n========================================');
    console.log('Step 7: ID比較（重要）');
    console.log('========================================');

    if (dbAd && (targetAd || targetSmartPlusAd)) {
      const apiAdId = targetAd?.ad_id || targetSmartPlusAd?.smart_plus_ad_id;
      console.log(`\nDBのtiktokId: ${dbAd.tiktokId}`);
      console.log(`APIのad_id: ${apiAdId}`);
      console.log(`一致: ${dbAd.tiktokId === apiAdId ? '✓' : '❌'}`);
    }

  } catch (error: any) {
    console.error('❌ エラー:', error.message);
    console.error(error.stack);
  } finally {
    await app.close();
  }
}

main();
