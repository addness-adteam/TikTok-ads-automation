/**
 * 正しい広告IDでAI1アカウントのメトリクスを確認
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkCorrectAd() {
  try {
    const tiktokAdId = '1848545700919346';

    console.log('========================================');
    console.log('AI1広告メトリクス確認（正しいID）');
    console.log('========================================\n');

    // TikTok IDで広告を検索
    const ad = await prisma.ad.findUnique({
      where: { tiktokId: tiktokAdId },
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
      console.log(`❌ 広告が見つかりません: TikTok ID ${tiktokAdId}`);
      console.log('\nデータベースに存在しない可能性があります。');
      console.log('エンティティ同期を実行する必要があるかもしれません。');
      return;
    }

    console.log(`✓ 広告を発見:`);
    console.log(`  - DB ID: ${ad.id}`);
    console.log(`  - TikTok ID: ${ad.tiktokId}`);
    console.log(`  - 広告名: ${ad.name}`);
    console.log(`  - Advertiser: ${ad.adGroup.campaign.advertiser.name}`);
    console.log(`  - ステータス: ${ad.status}\n`);

    // 対象期間のメトリクスを取得
    const startDate = new Date('2025-11-16T00:00:00+09:00');
    const endDate = new Date('2025-11-22T23:59:59+09:00');

    const metrics = await prisma.metric.findMany({
      where: {
        adId: ad.id,
        statDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { statDate: 'asc' },
    });

    console.log(`✓ 対象期間（11/16～11/22）: ${metrics.length}件のメトリクスレコードを取得\n`);

    if (metrics.length === 0) {
      console.log('⚠️  対象期間のメトリクスが見つかりません！');
      return;
    }

    // 日付ごとにグループ化して重複確認
    console.log('日付ごとのメトリクス:');
    console.log('─'.repeat(100));
    console.log('日付       | レコード数 | Impressions | Clicks | Spend (円)');
    console.log('─'.repeat(100));

    const dateMetricsMap = new Map<string, typeof metrics>();

    for (const metric of metrics) {
      const dateKey = metric.statDate.toISOString().split('T')[0];
      if (!dateMetricsMap.has(dateKey)) {
        dateMetricsMap.set(dateKey, []);
      }
      dateMetricsMap.get(dateKey)!.push(metric);
    }

    let totalSpend = 0;
    const duplicateDates: string[] = [];

    for (const [date, dateMetrics] of Array.from(dateMetricsMap.entries()).sort()) {
      const recordCount = dateMetrics.length;
      const totalImpressions = dateMetrics.reduce((sum: number, m: any) => sum + m.impressions, 0);
      const totalClicks = dateMetrics.reduce((sum: number, m: any) => sum + m.clicks, 0);
      const totalSpendForDate = dateMetrics.reduce((sum: number, m: any) => sum + m.spend, 0);

      console.log(
        `${date} | ${recordCount.toString().padEnd(10)} | ${totalImpressions.toString().padEnd(11)} | ${totalClicks.toString().padEnd(6)} | ${totalSpendForDate.toFixed(2)}`
      );

      totalSpend += totalSpendForDate;

      if (recordCount > 1) {
        duplicateDates.push(date);
      }
    }

    console.log('─'.repeat(100));
    console.log(`合計支出: ¥${totalSpend.toFixed(2)}\n`);

    if (duplicateDates.length > 0) {
      console.log(`⚠️  重複レコードが検出されました: ${duplicateDates.join(', ')}\n`);

      // 重複の詳細を表示
      for (const date of duplicateDates) {
        const dateMetrics = dateMetricsMap.get(date)!;
        console.log(`【${date}の詳細】`);
        console.log('─'.repeat(80));

        for (let i = 0; i < dateMetrics.length; i++) {
          const m = dateMetrics[i];
          console.log(`レコード ${i + 1}:`);
          console.log(`  ID: ${m.id}`);
          console.log(`  作成日時: ${m.createdAt.toISOString()}`);
          console.log(`  Spend: ¥${m.spend.toFixed(2)}`);
          console.log('');
        }
      }
    } else {
      console.log('✓ 重複レコードは検出されませんでした\n');
    }

    console.log('========================================');
    console.log('比較結果');
    console.log('========================================');
    console.log(`データベース集計: ¥${totalSpend.toFixed(2)}`);
    console.log(`広告マネージャー: ¥98,818`);
    console.log(`差異: ¥${(totalSpend - 98818).toFixed(2)} (${((totalSpend / 98818 - 1) * 100).toFixed(2)}%)\n`);

    if (Math.abs(totalSpend - 98818) < 1) {
      console.log('✓ 差異はほぼゼロです！重複が解消されています。');
    } else if (totalSpend > 98818) {
      console.log('⚠️  データベースの方が高い → まだ重複が残っている可能性');
    } else {
      console.log('⚠️  データベースの方が低い → メトリクス同期に問題がある可能性');
    }

  } catch (error) {
    console.error('エラーが発生しました:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkCorrectAd();
