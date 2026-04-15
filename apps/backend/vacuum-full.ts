import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const remaining = await prisma.hourlyOptimizationSnapshot.count();
  console.log(`Remaining snapshots: ${remaining}`);

  console.log('Running VACUUM FULL (this locks the table and reclaims disk space)...');
  await prisma.$executeRawUnsafe('VACUUM FULL hourly_optimization_snapshots');
  console.log('VACUUM FULL done');

  const dbSize = await prisma.$queryRawUnsafe(
    `SELECT pg_size_pretty(pg_database_size(current_database())) as db_size`,
  ) as any[];
  console.log(`DB size: ${dbSize[0].db_size}`);

  const snapshotSize = await prisma.$queryRawUnsafe(
    `SELECT pg_size_pretty(pg_total_relation_size('hourly_optimization_snapshots')) as size`,
  ) as any[];
  console.log(`Snapshot table size: ${snapshotSize[0].size}`);

  await prisma.$disconnect();
}

main().catch(console.error);
