import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);
  const todayStart = new Date(jstNow);
  todayStart.setUTCHours(0, 0, 0, 0);
  todayStart.setTime(todayStart.getTime() - jstOffset);

  console.log('Today (JST) start:', new Date(todayStart.getTime() + jstOffset).toISOString());

  const pauseLogs = await prisma.changeLog.findMany({
    where: {
      createdAt: {
        gte: todayStart
      },
      action: 'PAUSE'
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log('\n=== PAUSE ChangeLog (Today) ===');
  console.log('Total PAUSE logs:', pauseLogs.length);
  pauseLogs.forEach(log => {
    console.log('---');
    console.log('Entity:', log.entityType, log.entityId);
    console.log('Action:', log.action);
    console.log('Reason:', log.reason);
    console.log('Time:', log.createdAt);
  });

  const allLogs = await prisma.changeLog.findMany({
    where: {
      createdAt: {
        gte: todayStart
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log('\n=== All ChangeLog (Today) ===');
  console.log('Total logs:', allLogs.length);
  
  const actionCounts: Record<string, number> = {};
  allLogs.forEach(log => {
    actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
  });
  console.log('Actions breakdown:', JSON.stringify(actionCounts, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
