/**
 * メトリクスの差異を調査するスクリプト
 * 広告マネージャーとの差異の原因を特定する
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function investigateMetricDiscrepancy() {
  try {
    const adName = '251020/在中悠也/生意気なスタッフ_冒頭3_オファー1/LP1-CR00627';

    console.log('========================================');
    console.log('広告メトリクス差異調査 (AI1アカウント)');
    console.log('========================================\n');

    console.log(`対象広告名: ${adName}`);
    console.log(`対象期間: 2025/11/16 ~ 2025/11/22\n`);

    // ステップ1: 広告レコードを検索
    console.log('ステップ1: 広告レコードを検索中...');
    const ad = await prisma.ad.findFirst({
      where: {
        name: adName,
      },
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
    console.log(`  - Advertiser: ${ad.adGroup.campaign.advertiser.name}\n`);

    // ステップ2: 対象期間のメトリクスを取得
    console.log('ステップ2: 対象期間のメトリクスを取得中...');
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
      orderBy: {
        statDate: 'asc',
      },
    });

    console.log(`✓ ${metrics.length}件のメトリクスレコードを発見\n`);

    // ステップ3: 日付ごとにグループ化して重複を確認
    console.log('ステップ3: 日付ごとのメトリクスを分析...');
    console.log('─'.repeat(100));
    console.log('日付          | レコード数 | Impressions | Clicks | Spend (円) | Entity Type');
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
    let duplicateDates: string[] = [];

    for (const [date, dateMetrics] of Array.from(dateMetricsMap.entries()).sort()) {
      const recordCount = dateMetrics.length;
      const totalImpressions = dateMetrics.reduce((sum: number, m: any) => sum + m.impressions, 0);
      const totalClicks = dateMetrics.reduce((sum: number, m: any) => sum + m.clicks, 0);
      const totalSpendForDate = dateMetrics.reduce((sum: number, m: any) => sum + m.spend, 0);
      const entityTypes = [...new Set(dateMetrics.map((m: any) => m.entityType))].join(', ');

      console.log(
        `${date} | ${recordCount.toString().padEnd(10)} | ${totalImpressions.toString().padEnd(11)} | ${totalClicks.toString().padEnd(6)} | ${totalSpendForDate.toFixed(2).padEnd(10)} | ${entityTypes}`
      );

      totalSpend += totalSpendForDate;

      if (recordCount > 1) {
        duplicateDates.push(date);
      }
    }

    console.log('─'.repeat(100));
    console.log(`合計支出: ¥${totalSpend.toFixed(2)}\n`);

    // ステップ4: 重複がある日付の詳細を表示
    if (duplicateDates.length > 0) {
      console.log('⚠️  重複レコードが検出されました！');
      console.log(`重複がある日付: ${duplicateDates.join(', ')}\n`);

      for (const date of duplicateDates) {
        const dateMetrics = dateMetricsMap.get(date)!;
        console.log(`\n【${date}の詳細】`);
        console.log('─'.repeat(80));

        for (let i = 0; i < dateMetrics.length; i++) {
          const m = dateMetrics[i];
          console.log(`レコード ${i + 1}:`);
          console.log(`  ID: ${m.id}`);
          console.log(`  Entity Type: ${m.entityType}`);
          console.log(`  作成日時: ${m.createdAt.toISOString()}`);
          console.log(`  Impressions: ${m.impressions}`);
          console.log(`  Clicks: ${m.clicks}`);
          console.log(`  Spend: ¥${m.spend.toFixed(2)}`);
          console.log('');
        }
      }
    } else {
      console.log('✓ 重複レコードは検出されませんでした');
    }

    // ステップ5: 広告マネージャーとの比較
    console.log('\n========================================');
    console.log('比較結果');
    console.log('========================================');
    console.log(`データベース集計: ¥${totalSpend.toFixed(2)}`);
    console.log(`広告マネージャー: ¥46,365`);
    console.log(`差異: ¥${(totalSpend - 46365).toFixed(2)} (${((totalSpend / 46365 - 1) * 100).toFixed(2)}%)\n`);

    // ステップ6: 考えられる原因を分析
    console.log('考えられる原因:');

    if (duplicateDates.length > 0) {
      console.log('1. ✓ 同じ日付で複数のメトリクスレコードが存在（重複保存）');
    }

    const hasMultipleEntityTypes = new Set(metrics.map((m: any) => m.entityType)).size > 1;
    if (hasMultipleEntityTypes) {
      console.log('2. ✓ 複数のエンティティタイプのメトリクスが混在');
      const entityTypeCounts = metrics.reduce((acc: any, m: any) => {
        acc[m.entityType] = (acc[m.entityType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      console.log(`   エンティティタイプ内訳: ${JSON.stringify(entityTypeCounts)}`);
    }

    console.log('\n推奨対応:');
    if (duplicateDates.length > 0) {
      console.log('- データベース内の重複メトリクスレコードを削除');
      console.log('- saveReportMetrics() で findFirst() の代わりに unique 制約を使用');
    }

  } catch (error) {
    console.error('エラーが発生しました:', error);
  } finally {
    await prisma.$disconnect();
  }
}

investigateMetricDiscrepancy();
