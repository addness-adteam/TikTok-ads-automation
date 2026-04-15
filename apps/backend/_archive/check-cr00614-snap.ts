import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // CR00614のスナップショットを検索（adNameにCR00614を含む）
  const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      OR: [
        { adName: { contains: 'CR00614' } },
        { adId: { in: ['1862150030125057'] } }, // adgroup_id
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  console.log(`=== Snapshots for CR00614 (${snaps.length}) ===`);
  for (const s of snaps) {
    console.log(`${s.createdAt} | ${s.adId} | ${s.adName} | action: ${s.action} | reason: ${s.reason} | budget: ${s.dailyBudget} | newBudget: ${s.newBudget}`);
  }

  // changeLogでbudget decrease
  const logs = await prisma.changeLog.findMany({
    where: {
      OR: [
        { reason: { contains: 'CR00614' } },
        { reason: { contains: '予算20%ダウン' } },
      ],
      createdAt: { gte: new Date('2026-04-11') },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  console.log(`\n=== ChangeLogs budget decrease today (${logs.length}) ===`);
  for (const l of logs) {
    console.log(`${l.createdAt} | ${l.action} | ${l.entityId} | ${l.reason}`);
  }

  await prisma.$disconnect();
}
main().catch(console.error);
