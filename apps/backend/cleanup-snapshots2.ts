import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 日別のレコード数を確認
  const daily = await prisma.$queryRawUnsafe(`
    SELECT date_trunc('day', "createdAt") as day, count(*) as cnt
    FROM hourly_optimization_snapshots
    GROUP BY day ORDER BY day DESC LIMIT 15
  `) as any[];

  console.log('=== Daily snapshot counts ===');
  for (const row of daily) {
    console.log(`${new Date(row.day).toISOString().slice(0,10)}: ${Number(row.cnt)} records`);
  }

  const total = await prisma.hourlyOptimizationSnapshot.count();
  console.log(`\nTotal: ${total}`);

  // 7日以上前のデータを削除（7日分あれば十分）
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const countOld = await prisma.hourlyOptimizationSnapshot.count({
    where: { createdAt: { lt: cutoff } },
  });
  console.log(`Snapshots older than 7 days: ${countOld}`);
  console.log(`Delete? (proceeding...)`);

  let deleted = 0;
  while (true) {
    const batch = await prisma.hourlyOptimizationSnapshot.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    deleted += batch.count;
    console.log(`Deleted batch: ${batch.count}, total: ${deleted}`);
    if (batch.count === 0) break;
  }

  // VACUUMでディスクスペース回収
  console.log('Running VACUUM...');
  await prisma.$executeRawUnsafe('VACUUM hourly_optimization_snapshots');

  const dbSize = await prisma.$queryRawUnsafe(
    `SELECT pg_size_pretty(pg_database_size(current_database())) as db_size`,
  ) as any[];
  console.log(`DB size after: ${dbSize[0].db_size}`);

  const snapshotSize = await prisma.$queryRawUnsafe(
    `SELECT pg_size_pretty(pg_total_relation_size('hourly_optimization_snapshots')) as size`,
  ) as any[];
  console.log(`Snapshot table size after: ${snapshotSize[0].size}`);

  await prisma.$disconnect();
}

main().catch(console.error);
