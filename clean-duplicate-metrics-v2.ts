/**
 * 重複メトリクスレコードを削除するスクリプト（改訂版）
 * より単純なロジックで重複を検出
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanDuplicateMetrics() {
  try {
    console.log('========================================');
    console.log('重複メトリクスレコードの削除（改訂版）');
    console.log('========================================\n');

    // ステップ1: ADレベルのメトリクスで重複を検出
    console.log('ステップ1: ADレベルの重複を検出中...\n');

    const adMetrics = await prisma.metric.findMany({
      where: {
        entityType: 'AD',
        adId: { not: null },
      },
      orderBy: [
        { adId: 'asc' },
        { statDate: 'asc' },
        { createdAt: 'desc' }, // 最新を先に
      ],
    });

    console.log(`✓ ${adMetrics.length} 件のADメトリクスを取得\n`);

    // adId + statDate でグループ化
    const adGroups = new Map<string, any[]>();

    for (const metric of adMetrics) {
      if (!metric.adId) continue;

      const key = `${metric.adId}:${metric.statDate.toISOString().split('T')[0]}`;
      if (!adGroups.has(key)) {
        adGroups.set(key, []);
      }
      adGroups.get(key)!.push(metric);
    }

    const adDuplicates = Array.from(adGroups.entries())
      .filter(([_, metrics]) => metrics.length > 1)
      .map(([key, metrics]) => ({ key, metrics }));

    console.log(`✓ ADレベル: ${adDuplicates.length} グループで重複を検出`);
    console.log(`✓ 削除対象: ${adDuplicates.reduce((sum, g) => sum + g.metrics.length - 1, 0)} 件\n`);

    // ステップ2: ADGROUPレベルの重複を検出
    console.log('ステップ2: ADGROUPレベルの重複を検出中...\n');

    const adgroupMetrics = await prisma.metric.findMany({
      where: {
        entityType: 'ADGROUP',
        adgroupId: { not: null },
      },
      orderBy: [
        { adgroupId: 'asc' },
        { statDate: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    console.log(`✓ ${adgroupMetrics.length} 件のADGROUPメトリクスを取得\n`);

    const adgroupGroups = new Map<string, any[]>();

    for (const metric of adgroupMetrics) {
      if (!metric.adgroupId) continue;

      const key = `${metric.adgroupId}:${metric.statDate.toISOString().split('T')[0]}`;
      if (!adgroupGroups.has(key)) {
        adgroupGroups.set(key, []);
      }
      adgroupGroups.get(key)!.push(metric);
    }

    const adgroupDuplicates = Array.from(adgroupGroups.entries())
      .filter(([_, metrics]) => metrics.length > 1)
      .map(([key, metrics]) => ({ key, metrics }));

    console.log(`✓ ADGROUPレベル: ${adgroupDuplicates.length} グループで重複を検出`);
    console.log(`✓ 削除対象: ${adgroupDuplicates.reduce((sum, g) => sum + g.metrics.length - 1, 0)} 件\n`);

    // ステップ3: CAMPAIGNレベルの重複を検出
    console.log('ステップ3: CAMPAIGNレベルの重複を検出中...\n');

    const campaignMetrics = await prisma.metric.findMany({
      where: {
        entityType: 'CAMPAIGN',
        campaignId: { not: null },
      },
      orderBy: [
        { campaignId: 'asc' },
        { statDate: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    console.log(`✓ ${campaignMetrics.length} 件のCAMPAIGNメトリクスを取得\n`);

    const campaignGroups = new Map<string, any[]>();

    for (const metric of campaignMetrics) {
      if (!metric.campaignId) continue;

      const key = `${metric.campaignId}:${metric.statDate.toISOString().split('T')[0]}`;
      if (!campaignGroups.has(key)) {
        campaignGroups.set(key, []);
      }
      campaignGroups.get(key)!.push(metric);
    }

    const campaignDuplicates = Array.from(campaignGroups.entries())
      .filter(([_, metrics]) => metrics.length > 1)
      .map(([key, metrics]) => ({ key, metrics }));

    console.log(`✓ CAMPAIGNレベル: ${campaignDuplicates.length} グループで重複を検出`);
    console.log(`✓ 削除対象: ${campaignDuplicates.reduce((sum, g) => sum + g.metrics.length - 1, 0)} 件\n`);

    // 全ての重複をマージ
    const allDuplicates = [...adDuplicates, ...adgroupDuplicates, ...campaignDuplicates];
    const totalToDelete = allDuplicates.reduce((sum, g) => sum + g.metrics.length - 1, 0);

    if (allDuplicates.length === 0) {
      console.log('✓ 重複レコードは見つかりませんでした。');
      return;
    }

    // ステップ4: 重複の詳細を表示
    console.log('ステップ4: 重複の詳細（サンプル）\n');
    console.log('─'.repeat(120));

    allDuplicates.slice(0, 5).forEach((group, index) => {
      console.log(`\nグループ ${index + 1}: ${group.key}`);
      console.log(`レコード数: ${group.metrics.length}`);

      group.metrics.forEach((metric: any, i: number) => {
        const status = i === 0 ? '✓ 保持' : '✗ 削除';
        console.log(`  ${status} | ID: ${metric.id.substring(0, 20)} | Created: ${metric.createdAt.toISOString()} | Spend: ¥${metric.spend.toFixed(2)}`);
      });
    });

    console.log('\n─'.repeat(120));
    console.log(`\n合計削除対象: ${totalToDelete} 件\n`);

    // ステップ5: 削除を実行
    console.log('ステップ5: 重複レコードを削除中...\n');

    let deletedCount = 0;

    for (const group of allDuplicates) {
      // 最初（最新のcreatedAt）を残し、残りを削除
      const toDelete = group.metrics.slice(1);

      for (const metric of toDelete) {
        await prisma.metric.delete({
          where: { id: metric.id },
        });
        deletedCount++;

        if (deletedCount % 100 === 0) {
          console.log(`  進捗: ${deletedCount} / ${totalToDelete} 件削除`);
        }
      }
    }

    console.log(`\n✓ ${deletedCount} 件の重複レコードを削除しました\n`);

    // ステップ6: 削除後の確認
    console.log('ステップ6: 削除後の確認\n');

    const totalBefore = adMetrics.length + adgroupMetrics.length + campaignMetrics.length;
    const totalAfter = await prisma.metric.count();

    console.log(`削除前: ${totalBefore} 件`);
    console.log(`削除数: ${deletedCount} 件`);
    console.log(`削除後: ${totalAfter} 件`);
    console.log(`期待値: ${totalBefore - deletedCount} 件`);
    console.log(`一致: ${totalAfter === totalBefore - deletedCount ? '✓' : '✗'}\n`);

    console.log('========================================');
    console.log('処理完了');
    console.log('========================================');

  } catch (error) {
    console.error('エラーが発生しました:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

cleanDuplicateMetrics();
