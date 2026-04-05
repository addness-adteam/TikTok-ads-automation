/**
 * 重複メトリクスレコードを削除するスクリプト
 *
 * 各 (entityType, adId, statDate) または (entityType, adgroupId, statDate) または
 * (entityType, campaignId, statDate) の組み合わせで、最新のレコードのみを残す
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanDuplicateMetrics() {
  try {
    console.log('========================================');
    console.log('重複メトリクスレコードの削除');
    console.log('========================================\n');

    // ステップ1: 全メトリクスを取得して重複を検出
    console.log('ステップ1: 重複レコードを検出中...\n');

    const allMetrics = await prisma.metric.findMany({
      orderBy: [
        { entityType: 'asc' },
        { statDate: 'asc' },
        { createdAt: 'desc' }, // 最新のレコードを先に
      ],
    });

    console.log(`✓ 合計 ${allMetrics.length} 件のメトリクスレコードを取得\n`);

    // エンティティごとにグループ化
    interface MetricKey {
      entityType: string;
      entityId: string;
      statDate: string;
    }

    const metricsMap = new Map<string, any[]>();

    for (const metric of allMetrics) {
      // エンティティIDを決定
      let entityId: string;
      if (metric.adId) {
        entityId = `AD:${metric.adId}`;
      } else if (metric.adgroupId) {
        entityId = `ADGROUP:${metric.adgroupId}`;
      } else if (metric.campaignId) {
        entityId = `CAMPAIGN:${metric.campaignId}`;
      } else {
        console.warn(`⚠️  レコード ${metric.id} にエンティティIDがありません`);
        continue;
      }

      const key = `${metric.entityType}:${entityId}:${metric.statDate.toISOString()}`;

      if (!metricsMap.has(key)) {
        metricsMap.set(key, []);
      }
      metricsMap.get(key)!.push(metric);
    }

    // ステップ2: 重複を特定
    console.log('ステップ2: 重複レコードを特定中...\n');

    const duplicateGroups: Array<{ key: string; metrics: any[] }> = [];
    let totalDuplicates = 0;

    for (const [key, metrics] of metricsMap.entries()) {
      if (metrics.length > 1) {
        duplicateGroups.push({ key, metrics });
        totalDuplicates += metrics.length - 1; // 1つを残すので、-1
      }
    }

    console.log(`✓ ${duplicateGroups.length} 個のグループで重複を検出`);
    console.log(`✓ 削除対象: ${totalDuplicates} 件のレコード\n`);

    if (duplicateGroups.length === 0) {
      console.log('重複レコードはありません。処理を終了します。');
      return;
    }

    // ステップ3: 重複の詳細を表示
    console.log('ステップ3: 重複の詳細\n');
    console.log('─'.repeat(120));
    console.log('グループ | レコード数 | Entity Type | Entity ID | Stat Date | 削除数');
    console.log('─'.repeat(120));

    duplicateGroups.slice(0, 10).forEach((group, index) => {
      const firstMetric = group.metrics[0];
      const entityId = firstMetric.adId || firstMetric.adgroupId || firstMetric.campaignId;
      console.log(
        `${(index + 1).toString().padEnd(8)} | ${group.metrics.length.toString().padEnd(10)} | ${firstMetric.entityType.padEnd(11)} | ${entityId.substring(0, 20).padEnd(9)} | ${firstMetric.statDate.toISOString().split('T')[0]} | ${group.metrics.length - 1}`
      );
    });

    if (duplicateGroups.length > 10) {
      console.log(`... 他 ${duplicateGroups.length - 10} グループ`);
    }
    console.log('─'.repeat(120));
    console.log('');

    // ステップ4: 削除の確認（ドライラン）
    console.log('ステップ4: 削除するレコードの詳細確認（サンプル）\n');

    if (duplicateGroups.length > 0) {
      const sampleGroup = duplicateGroups[0];
      console.log(`サンプルグループ: ${sampleGroup.key}`);
      console.log('─'.repeat(80));

      sampleGroup.metrics.forEach((metric: any, index: number) => {
        const status = index === 0 ? '✓ 保持' : '✗ 削除';
        console.log(`${status} | ID: ${metric.id} | Created: ${metric.createdAt.toISOString()} | Spend: ¥${metric.spend}`);
      });
      console.log('');
    }

    // ステップ5: 削除を実行
    console.log('ステップ5: 重複レコードを削除中...\n');

    let deletedCount = 0;
    const deletionLog: Array<{ id: string; entityType: string; statDate: Date; spend: number }> = [];

    for (const group of duplicateGroups) {
      // 最初のレコード（最新のcreatedAt）を残し、残りを削除
      const toDelete = group.metrics.slice(1);

      for (const metric of toDelete) {
        deletionLog.push({
          id: metric.id,
          entityType: metric.entityType,
          statDate: metric.statDate,
          spend: metric.spend,
        });

        await prisma.metric.delete({
          where: { id: metric.id },
        });

        deletedCount++;
      }
    }

    console.log(`✓ ${deletedCount} 件の重複レコードを削除しました\n`);

    // ステップ6: 削除後の確認
    console.log('ステップ6: 削除後の確認\n');

    const remainingMetrics = await prisma.metric.findMany();
    console.log(`残りのメトリクスレコード数: ${remainingMetrics.length}`);
    console.log(`削除前: ${allMetrics.length}`);
    console.log(`削除数: ${deletedCount}`);
    console.log(`期待値: ${allMetrics.length - deletedCount}`);
    console.log(`一致: ${remainingMetrics.length === allMetrics.length - deletedCount ? '✓' : '✗'}\n`);

    // ステップ7: 削除ログを保存（オプション）
    console.log('ステップ7: 削除ログを保存中...\n');

    const logFilePath = './metric-deletion-log.json';
    const fs = require('fs');
    fs.writeFileSync(
      logFilePath,
      JSON.stringify(
        {
          deletedAt: new Date().toISOString(),
          totalDeleted: deletedCount,
          deletions: deletionLog,
        },
        null,
        2
      )
    );

    console.log(`✓ 削除ログを保存しました: ${logFilePath}\n`);

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

// 実行前の確認
console.log('⚠️  このスクリプトは重複メトリクスレコードを削除します。');
console.log('⚠️  各グループで最新の createdAt を持つレコードのみが保持されます。\n');

cleanDuplicateMetrics();
