import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  const snapshots = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      adName: { contains: 'CR01190' },
      executionTime: {
        gte: new Date('2026-04-08T15:00:00Z'),
        lt: new Date('2026-04-09T15:00:00Z'),
      },
    },
    orderBy: { executionTime: 'asc' },
    select: {
      todayCVCount: true,
      todaySpend: true,
      todayCPA: true,
      dailyBudget: true,
      action: true,
      reason: true,
      newBudget: true,
      executionTime: true,
    },
  });

  for (const s of snapshots) {
    const jst = new Date(s.executionTime.getTime() + 9 * 60 * 60 * 1000);
    const timeStr = jst.toISOString().slice(11, 16);
    console.log(
      `${timeStr} JST | CV=${s.todayCVCount} | spend=¥${s.todaySpend?.toFixed(0)} | CPA=${s.todayCPA ? '¥' + s.todayCPA.toFixed(0) : 'N/A'} | budget=¥${s.dailyBudget?.toFixed(0)} → ${s.newBudget ? '¥' + s.newBudget.toFixed(0) : '-'} | ${s.action} | ${s.reason || ''}`
    );
  }
  console.log(`\nTotal snapshots: ${snapshots.length}`);

  await prisma.$disconnect();
}

main().catch(console.error);
