import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  console.log('メトリクスデータの確認中...\n');

  const minDate = await prisma.metric.findFirst({
    orderBy: { statDate: 'asc' },
    select: { statDate: true }
  });

  const maxDate = await prisma.metric.findFirst({
    orderBy: { statDate: 'desc' },
    select: { statDate: true }
  });

  console.log('メトリクスの日付範囲:');
  console.log('  最古:', minDate?.statDate);
  console.log('  最新:', maxDate?.statDate);

  // 2025年12月のデータを確認
  const dec2025Count = await prisma.metric.count({
    where: {
      statDate: {
        gte: new Date('2025-12-01T00:00:00.000Z'),
        lte: new Date('2025-12-31T23:59:59.999Z'),
      }
    }
  });
  console.log('\n2025年12月のメトリクス件数:', dec2025Count);

  // 2024年12月のデータを確認
  const dec2024Count = await prisma.metric.count({
    where: {
      statDate: {
        gte: new Date('2024-12-01T00:00:00.000Z'),
        lte: new Date('2024-12-31T23:59:59.999Z'),
      }
    }
  });
  console.log('2024年12月のメトリクス件数:', dec2024Count);

  // entityType別の件数
  const byEntityType = await prisma.metric.groupBy({
    by: ['entityType'],
    _count: true,
  });
  console.log('\nentityType別件数:');
  for (const item of byEntityType) {
    console.log(`  ${item.entityType}: ${item._count}件`);
  }

  // 月別のデータ件数
  const metrics = await prisma.$queryRaw`
    SELECT
      strftime('%Y-%m', statDate) as month,
      COUNT(*) as count
    FROM metrics
    GROUP BY strftime('%Y-%m', statDate)
    ORDER BY month DESC
    LIMIT 12
  `;
  console.log('\n月別メトリクス件数:');
  console.log(metrics);

  await prisma.$disconnect();
}

check();
