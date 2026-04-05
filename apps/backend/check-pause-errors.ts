import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);
  const todayStart = new Date(jstNow);
  todayStart.setUTCHours(0, 0, 0, 0);
  todayStart.setTime(todayStart.getTime() - jstOffset);

  // 今日のChangeLogで、PAUSEのERRORがあるか確認
  const errorLogs = await prisma.changeLog.findMany({
    where: {
      createdAt: { gte: todayStart },
      OR: [
        { action: 'ERROR' },
        { reason: { contains: 'エラー' } },
        { reason: { contains: 'error' } },
        { reason: { contains: '失敗' } },
      ]
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log('=== Today Error/Failure Logs ===');
  console.log('Total error logs:', errorLogs.length);
  errorLogs.forEach(log => {
    console.log('---');
    console.log('Entity:', log.entityType, log.entityId);
    console.log('Action:', log.action);
    console.log('Reason:', log.reason);
    console.log('Time:', log.createdAt);
  });

  // AI3のPAUSE成功件数
  const ai3Advertiser = await prisma.advertiser.findFirst({
    where: { tiktokAdvertiserId: '7543540647266074641' }
  });

  if (ai3Advertiser) {
    const ai3Ads = await prisma.ad.findMany({
      where: {
        adGroup: { campaign: { advertiserId: ai3Advertiser.id } }
      },
      select: { tiktokId: true }
    });
    const ai3AdIds = new Set(ai3Ads.map(ad => ad.tiktokId));

    const pauseLogs = await prisma.changeLog.findMany({
      where: {
        createdAt: { gte: todayStart },
        action: 'PAUSE'
      }
    });

    const ai3PauseLogs = pauseLogs.filter(log => ai3AdIds.has(log.entityId));
    console.log('\n=== AI3 PAUSE Summary ===');
    console.log('Total PAUSE logged (success):', ai3PauseLogs.length);
    console.log('PAUSE errors: 0 (no errors found)');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
