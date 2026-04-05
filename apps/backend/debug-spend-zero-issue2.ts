/**
 * 支出が0になる問題の詳細調査スクリプト
 * メトリクス同期のロジックを確認
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
  console.log('支出0問題の詳細調査');
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

    // 3. 対象広告「251126/清水絢吾/林社長→AI学ぶな②/LP1-CR00666」を直接検索
    console.log('========================================');
    console.log('Step 1: 対象広告をAPI+DBから検索');
    console.log('========================================');

    // Smart+ APIから検索（この広告はSmart+のはず）
    const smartPlusResponse = await tiktokService.getSmartPlusAds(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );

    const smartPlusAds = smartPlusResponse.data?.list || [];
    console.log(`Smart+ API: ${smartPlusAds.length}件取得`);

    // 広告名に「CR00666」を含む広告を検索
    const targetAd = smartPlusAds.find((ad: any) =>
      ad.ad_name && ad.ad_name.includes('CR00666')
    );

    if (targetAd) {
      console.log(`\n✓ 対象広告を発見（Smart+ API）:`);
      console.log(`  Smart+ Ad ID: ${targetAd.smart_plus_ad_id}`);
      console.log(`  Ad Name: ${targetAd.ad_name}`);
      console.log(`  Status: ${targetAd.operation_status}`);
      console.log(`  Campaign ID: ${targetAd.campaign_id}`);

      // DBで同じ広告を検索
      const dbAd = await prisma.ad.findFirst({
        where: {
          OR: [
            { tiktokId: targetAd.smart_plus_ad_id },
            { name: { contains: 'CR00666' } }
          ]
        },
        include: {
          adGroup: true,
          metrics: {
            orderBy: { statDate: 'desc' },
            take: 10
          }
        }
      });

      if (dbAd) {
        console.log(`\n✓ DBでも発見:`);
        console.log(`  DB ID: ${dbAd.id}`);
        console.log(`  TikTok ID in DB: ${dbAd.tiktokId}`);
        console.log(`  Name in DB: ${dbAd.name}`);
        console.log(`  Metrics count: ${dbAd.metrics.length}`);

        if (dbAd.metrics.length > 0) {
          console.log(`\n  最新10件のメトリクス:`);
          dbAd.metrics.forEach((m, i) => {
            console.log(`    [${i + 1}] ${m.statDate.toISOString().split('T')[0]} - imp: ${m.impressions}, spend: ${m.spend}`);
          });
        }
      } else {
        console.log(`\n⚠️ DBでは見つかりません（IDの不一致？）`);
      }
    } else {
      console.log('⚠️ 対象広告がSmart+ APIで見つかりません');

      // 通常のad/getでも検索
      const adsResponse = await tiktokService.getAds(
        advertiser.tiktokAdvertiserId,
        token.accessToken
      );
      const allAds = adsResponse.data?.list || [];
      const targetNormalAd = allAds.find((ad: any) =>
        ad.ad_name && ad.ad_name.includes('CR00666')
      );

      if (targetNormalAd) {
        console.log(`\n✓ 通常広告APIで発見:`);
        console.log(`  Ad ID: ${targetNormalAd.ad_id}`);
        console.log(`  Ad Name: ${targetNormalAd.ad_name}`);
      }
    }

    // 4. TikTok APIからリアルタイムでメトリクスを取得
    console.log('\n========================================');
    console.log('Step 2: TikTok APIから直接メトリクスを取得');
    console.log('========================================');

    // 過去7日間の日付
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);

    const startDateStr = startDate.toISOString().split('T')[0].replace(/-/g, '');
    const endDateStr = endDate.toISOString().split('T')[0].replace(/-/g, '');

    console.log(`\n期間: ${startDateStr} ~ ${endDateStr}`);

    if (targetAd) {
      // Smart+広告のメトリクスを取得
      try {
        const metricsResponse = await tiktokService.getSmartPlusAdMetrics(
          advertiser.tiktokAdvertiserId,
          token.accessToken,
          {
            startDate: startDateStr,
            endDate: endDateStr,
            smartPlusAdIds: [targetAd.smart_plus_ad_id],
          }
        );

        console.log(`\nSmart+ Ad Metrics API Response:`);
        console.log(JSON.stringify(metricsResponse, null, 2));
      } catch (error: any) {
        console.log(`\n❌ Smart+ Metrics API Error: ${error.message}`);
      }
    }

    // 5. DBのメトリクスを日別で確認
    console.log('\n========================================');
    console.log('Step 3: DBの全メトリクスの傾向を確認');
    console.log('========================================');

    // 日別のメトリクス合計を確認
    const dailyMetrics = await prisma.$queryRaw`
      SELECT
        DATE(stat_date) as date,
        COUNT(*) as count,
        SUM(spend) as total_spend,
        SUM(impressions) as total_impressions
      FROM metrics
      WHERE campaign_id IN (
        SELECT id FROM campaigns
        WHERE advertiser_id = ${advertiser.id}
      )
      AND stat_date >= ${startDate}
      AND stat_date <= ${endDate}
      GROUP BY DATE(stat_date)
      ORDER BY date DESC
    `;

    console.log('\n日別メトリクス合計:');
    console.log(dailyMetrics);

    // 6. spend > 0 のメトリクスがあるか確認
    console.log('\n========================================');
    console.log('Step 4: spend > 0 のメトリクスを確認');
    console.log('========================================');

    const metricsWithSpend = await prisma.metric.findMany({
      where: {
        spend: { gt: 0 },
        campaign: {
          advertiserId: advertiser.id
        }
      },
      orderBy: { statDate: 'desc' },
      take: 10,
      include: {
        ad: true
      }
    });

    console.log(`\nspend > 0 のメトリクス（最新10件）:`);
    if (metricsWithSpend.length === 0) {
      console.log('  ⚠️ 該当なし！すべてのメトリクスでspend=0');
    } else {
      metricsWithSpend.forEach((m, i) => {
        console.log(`  [${i + 1}] ${m.statDate.toISOString().split('T')[0]} - ${m.ad?.name?.substring(0, 30)} - spend: ${m.spend}`);
      });
    }

    // 7. メトリクス同期のタイミングを確認
    console.log('\n========================================');
    console.log('Step 5: 最新のメトリクス同期タイミング');
    console.log('========================================');

    const latestMetric = await prisma.metric.findFirst({
      where: {
        campaign: {
          advertiserId: advertiser.id
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (latestMetric) {
      console.log(`\n最新メトリクスの作成日時: ${latestMetric.createdAt}`);
      console.log(`統計日: ${latestMetric.statDate}`);
      console.log(`spend: ${latestMetric.spend}`);
      console.log(`impressions: ${latestMetric.impressions}`);
    }

  } catch (error: any) {
    console.error('❌ エラー:', error.message);
    console.error(error.stack);
  } finally {
    await app.close();
  }
}

main();
