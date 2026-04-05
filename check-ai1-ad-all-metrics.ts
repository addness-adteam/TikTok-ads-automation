/**
 * AI1アカウントの広告の全期間メトリクスを確認
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAllMetrics() {
  try {
    const adName = '251020/在中悠也/生意気なスタッフ_冒頭3_オファー1/LP1-CR00627';

    console.log('========================================');
    console.log('AI1広告の全期間メトリクス確認');
    console.log('========================================\n');

    // 広告を検索
    const ad = await prisma.ad.findFirst({
      where: { name: adName },
      include: {
        adGroup: {
          include: {
            campaign: {
              include: {
                advertiser: true,
              },
            },
          },
        },
      },
    });

    if (!ad) {
      console.log(`❌ 広告が見つかりません: ${adName}`);
      return;
    }

    console.log(`✓ 広告を発見:`);
    console.log(`  - DB ID: ${ad.id}`);
    console.log(`  - TikTok ID: ${ad.tiktokId}`);
    console.log(`  - 広告名: ${ad.name}`);
    console.log(`  - Advertiser: ${ad.adGroup.campaign.advertiser.name}`);
    console.log(`  - ステータス: ${ad.status}\n`);

    // 全メトリクスを取得
    const allMetrics = await prisma.metric.findMany({
      where: { adId: ad.id },
      orderBy: { statDate: 'asc' },
    });

    console.log(`✓ 合計 ${allMetrics.length} 件のメトリクスレコードを取得\n`);

    if (allMetrics.length === 0) {
      console.log('⚠️  この広告のメトリクスが1件も見つかりません！\n');
      console.log('考えられる原因:');
      console.log('1. メトリクス同期がまだ実行されていない');
      console.log('2. TikTok APIからデータが返されていない');
      console.log('3. 広告IDのマッピングに問題がある');
      return;
    }

    // 全期間のメトリクスを表示
    console.log('全期間のメトリクス:');
    console.log('─'.repeat(100));
    console.log('日付       | Impressions | Clicks | Spend (円) | Conversions | Entity Type');
    console.log('─'.repeat(100));

    let totalSpend = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalConversions = 0;

    for (const metric of allMetrics) {
      const date = metric.statDate.toISOString().split('T')[0];
      console.log(
        `${date} | ${metric.impressions.toString().padEnd(11)} | ${metric.clicks.toString().padEnd(6)} | ${metric.spend.toFixed(2).padEnd(10)} | ${metric.conversions.toString().padEnd(11)} | ${metric.entityType}`
      );

      totalSpend += metric.spend;
      totalImpressions += metric.impressions;
      totalClicks += metric.clicks;
      totalConversions += metric.conversions;
    }

    console.log('─'.repeat(100));
    console.log(`合計: Impressions=${totalImpressions}, Clicks=${totalClicks}, Spend=¥${totalSpend.toFixed(2)}, Conversions=${totalConversions}\n`);

    // 11/16～11/22の期間を抽出
    const startDate = new Date('2025-11-16T00:00:00+09:00');
    const endDate = new Date('2025-11-22T23:59:59+09:00');

    const periodMetrics = allMetrics.filter(
      (m) => m.statDate >= startDate && m.statDate <= endDate
    );

    const periodSpend = periodMetrics.reduce((sum, m) => sum + m.spend, 0);

    console.log('対象期間（11/16～11/22）のメトリクス:');
    console.log(`  - レコード数: ${periodMetrics.length}`);
    console.log(`  - 合計支出: ¥${periodSpend.toFixed(2)}\n`);

    console.log('========================================');
    console.log('比較結果');
    console.log('========================================');
    console.log(`データベース（11/16～11/22）: ¥${periodSpend.toFixed(2)}`);
    console.log(`予算調整ログ: ¥423,935`);
    console.log(`広告マネージャー: ¥98,818`);
    console.log(`差異（DB vs 広告マネージャー）: ¥${(periodSpend - 98818).toFixed(2)}\n`);

  } catch (error) {
    console.error('エラーが発生しました:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAllMetrics();
