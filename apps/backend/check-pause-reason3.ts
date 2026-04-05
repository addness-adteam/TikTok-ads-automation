import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // まず対象広告のadgroupIdを取得
  const ads = await prisma.ad.findMany({
    where: {
      OR: [
        { name: { contains: 'CR00734' } },
        { name: { contains: 'CR00724' } },
        { name: { contains: 'CR00733' } },
      ]
    },
    include: {
      adGroup: {
        select: { tiktokId: true, name: true }
      }
    }
  });

  console.log('=== 対象広告とAdGroup ===');
  for (const ad of ads) {
    console.log(`広告: ${ad.name}`);
    console.log(`  Ad ID: ${ad.id} | TikTok Ad ID: ${ad.tiktokId}`);
    console.log(`  AdGroup TikTok ID: ${ad.adGroup.tiktokId}`);
  }

  // 12/29 15:00頃の予算削減ログを確認
  console.log('\n=== 予算削減ログ (12/29-12/30) ===');
  const budgetLogs = await prisma.intradayBudgetReductionLog.findMany({
    where: {
      reductionTime: {
        gte: new Date('2024-12-29T00:00:00+09:00'),
      }
    },
    orderBy: { reductionTime: 'desc' },
    take: 30,
  });
  console.log(`Found ${budgetLogs.length} budget reduction logs`);
  for (const log of budgetLogs) {
    console.log(`  ${log.reductionTime.toISOString()} | AdGroup: ${log.adgroupId} | ${log.originalBudget} -> ${log.reducedBudget}`);
  }

  // 12/29 15:00頃の全停止ログを確認
  console.log('\n=== 停止ログ (12/29-12/30) ===');
  const pauseLogs = await prisma.intradayPauseLog.findMany({
    where: {
      pauseTime: {
        gte: new Date('2024-12-29T00:00:00+09:00'),
      }
    },
    orderBy: { pauseTime: 'desc' },
    include: {
      ad: {
        select: { name: true, tiktokId: true }
      }
    },
    take: 50,
  });
  console.log(`Found ${pauseLogs.length} pause logs`);
  for (const log of pauseLogs) {
    console.log(`  ${log.pauseTime.toISOString()} | ${log.pauseReason} | ${log.ad.name}`);
  }

  // 通知を確認
  console.log('\n=== 通知 (12/29-12/30) ===');
  const notifications = await prisma.notification.findMany({
    where: {
      createdAt: {
        gte: new Date('2024-12-29T00:00:00+09:00'),
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  console.log(`Found ${notifications.length} notifications`);
  for (const n of notifications) {
    console.log(`  ${n.createdAt.toISOString()} | ${n.type} | ${n.message.slice(0, 80)}`);
  }

  // 変更ログを確認 (12/29 14:00 - 12/30 12:00)
  console.log('\n=== 変更ログ (12/29 14:00 - 12/30 12:00) ===');
  const changeLogs = await prisma.changeLog.findMany({
    where: {
      createdAt: {
        gte: new Date('2024-12-29T14:00:00+09:00'),
        lte: new Date('2024-12-30T12:00:00+09:00'),
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  console.log(`Found ${changeLogs.length} change logs`);
  for (const log of changeLogs) {
    const desc = log.description ? log.description.slice(0, 60) : '';
    console.log(`  ${log.createdAt.toISOString()} | ${log.entityType} | ${log.action} | ${desc}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
