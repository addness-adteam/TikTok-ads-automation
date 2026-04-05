import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // SNS2の今日のスナップショットを確認
  const snapshots = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      advertiserId: '7543540100849156112',
      executionTime: {
        gte: new Date('2026-03-24T00:00:00+09:00'),
      },
    },
    orderBy: { executionTime: 'desc' },
    take: 30,
  });

  console.log(`=== SNS2 本日のスナップショット: ${snapshots.length}件 ===`);
  for (const s of snapshots) {
    console.log(`\n[${s.executionTime.toISOString()}] ${s.adName}`);
    console.log(`  action: ${s.action}, reason: ${s.reason}`);
    console.log(`  dailyBudget: ¥${s.dailyBudget}, todaySpend: ¥${s.todaySpend}`);
    console.log(`  todayCPA: ${s.todayCPA ? '¥' + Number(s.todayCPA).toFixed(0) : 'null'}, todayCV: ${s.todayCV}`);
    console.log(`  targetCPA: ${s.targetCPA ? '¥' + Number(s.targetCPA).toFixed(0) : 'null'}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
