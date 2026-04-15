import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 30日以上前のスナップショットを削除
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const countBefore = await prisma.hourlyOptimizationSnapshot.count();
  console.log(`Total snapshots before: ${countBefore}`);

  const countOld = await prisma.hourlyOptimizationSnapshot.count({
    where: { createdAt: { lt: cutoff } },
  });
  console.log(`Snapshots older than 30 days: ${countOld}`);
  console.log(`Cutoff date: ${cutoff.toISOString()}`);

  if (countOld === 0) {
    console.log('Nothing to delete');
    await prisma.$disconnect();
    return;
  }

  // バッチ削除（1000件ずつ）
  let deleted = 0;
  while (true) {
    const batch = await prisma.hourlyOptimizationSnapshot.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    deleted += batch.count;
    console.log(`Deleted batch: ${batch.count}, total deleted: ${deleted}`);
    if (batch.count === 0) break;
  }

  console.log(`\nTotal deleted: ${deleted}`);

  // VACUUM はNeonでは自動実行されるが、サイズ確認
  const dbSize = await prisma.$queryRawUnsafe(
    `SELECT pg_size_pretty(pg_database_size(current_database())) as db_size`,
  ) as any[];
  console.log(`DB size after cleanup: ${dbSize[0].db_size}`);

  const snapshotSize = await prisma.$queryRawUnsafe(
    `SELECT pg_size_pretty(pg_total_relation_size('hourly_optimization_snapshots')) as size`,
  ) as any[];
  console.log(`Snapshot table size: ${snapshotSize[0].size}`);

  await prisma.$disconnect();
}

main().catch(console.error);
