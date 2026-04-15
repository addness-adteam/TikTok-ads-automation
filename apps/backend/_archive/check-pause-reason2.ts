import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adIds = [
    'addcaa14-0a74-4ba1-bd5c-195164965687', // CR00724
    'e0621f41-2f6d-432b-a570-728326ab4228', // CR00733
    '2bdf434e-376a-4af9-b5fa-c3e093c12d63', // CR00734
  ];

  // IntradayBudgetReductionLog を確認
  console.log('=== IntradayBudgetReductionLog (予算削減ログ) ===');
  for (const adId of adIds) {
    const logs = await prisma.intradayBudgetReductionLog.findMany({
      where: { adId },
      orderBy: { reductionTime: 'desc' },
      take: 5,
    });
    console.log(`\nAd ID: ${adId.slice(0, 8)}... (${logs.length} logs)`);
    for (const log of logs) {
      console.log(`  ${log.reductionTime.toISOString()} | 理由: ${log.reductionReason} | 元予算: ${log.originalBudget} -> ${log.reducedBudget}`);
    }
  }

  // 12/29-12/30 の notification を確認
  console.log('\n=== Notifications (12/29-12/30) ===');
  const notifications = await prisma.notification.findMany({
    where: {
      createdAt: {
        gte: new Date('2024-12-29T00:00:00+09:00'),
      },
      OR: [
        { message: { contains: 'CR00724' } },
        { message: { contains: 'CR00733' } },
        { message: { contains: 'CR00734' } },
        { message: { contains: '停止' } },
        { message: { contains: 'pause' } },
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  console.log(`Found ${notifications.length} notifications`);
  for (const n of notifications) {
    console.log(`  ${n.createdAt.toISOString()} | ${n.type} | ${n.message.slice(0, 100)}`);
  }

  // 12/29午後15時頃の全変更ログを確認
  console.log('\n=== 12/29 15:00頃の全変更ログ ===');
  const allChangeLogs = await prisma.changeLog.findMany({
    where: {
      createdAt: {
        gte: new Date('2024-12-29T14:00:00+09:00'),
        lte: new Date('2024-12-29T17:00:00+09:00'),
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  console.log(`Found ${allChangeLogs.length} change logs`);
  for (const log of allChangeLogs) {
    const desc = log.description ? log.description.slice(0, 80) : '';
    console.log(`  ${log.createdAt.toISOString()} | ${log.entityType} | ${log.action} | ${desc}`);
  }

  // 全てのIntradayPauseLogを確認（12/29-12/30）
  console.log('\n=== 12/29-12/30 の全停止ログ ===');
  const allPauseLogs = await prisma.intradayPauseLog.findMany({
    where: {
      pauseTime: {
        gte: new Date('2024-12-29T00:00:00+09:00'),
      }
    },
    orderBy: { pauseTime: 'desc' },
    include: {
      ad: {
        select: { name: true }
      }
    },
    take: 30,
  });
  console.log(`Found ${allPauseLogs.length} pause logs`);
  for (const log of allPauseLogs) {
    console.log(`  ${log.pauseTime.toISOString()} | ${log.pauseReason} | ${log.ad.name.slice(-15)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
