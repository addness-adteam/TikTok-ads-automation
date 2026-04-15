import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 対象広告のTikTok ID
  const targetTiktokIds = [
    '1852043655860306', // CR00724
    '1852044836697202', // CR00733
    '1852171711209473', // CR00734
  ];

  console.log('=== 対象広告の停止ログ (IntradayPauseLog) ===');
  const pauseLogsForTargets = await prisma.intradayPauseLog.findMany({
    where: {
      adId: { in: targetTiktokIds }
    },
    orderBy: { pauseTime: 'desc' },
    take: 20,
  });
  console.log(`Found ${pauseLogsForTargets.length} pause logs for target ads`);
  for (const log of pauseLogsForTargets) {
    console.log(`  ${log.pauseTime.toISOString()} | Ad: ${log.adId} | 理由: ${log.pauseReason}`);
    console.log(`    消化: ${log.todaySpend}円 | 当日CPA: ${log.todayCPA || 'N/A'} | 再開: ${log.resumed}`);
  }

  // 12/29 15:00頃の全停止ログを確認
  console.log('\n=== 全停止ログ (12/29-12/30) ===');
  const allPauseLogs = await prisma.intradayPauseLog.findMany({
    where: {
      pauseTime: {
        gte: new Date('2024-12-29T00:00:00+09:00'),
      }
    },
    orderBy: { pauseTime: 'desc' },
    take: 50,
  });
  console.log(`Found ${allPauseLogs.length} pause logs total`);
  for (const log of allPauseLogs) {
    // 対応する広告名を取得
    const ad = await prisma.ad.findFirst({
      where: { tiktokId: log.adId },
      select: { name: true }
    });
    const adName = ad?.name || 'Unknown';
    console.log(`  ${log.pauseTime.toISOString()} | ${log.pauseReason} | ${adName.slice(-20)}`);
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

  // 変更ログを確認
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
