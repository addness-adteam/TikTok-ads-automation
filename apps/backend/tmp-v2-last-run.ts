import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 直近のV2実行
  const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
    orderBy: { executionTime: 'desc' },
    take: 10,
  });
  console.log('=== 直近のV2スナップショット ===');
  for (const s of snaps) {
    console.log(`${s.executionTime.toISOString()} | ${s.advertiserId} | ${s.action} | CV:${s.todayCVCount} | budget:${s.dailyBudget} | ${s.adName}`);
  }
  if (snaps.length === 0) console.log('スナップショットが0件');

  // 日別の実行回数（直近7日）
  console.log('\n=== 日別V2実行回数 ===');
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const dayStart = new Date(now.getTime() - (i + 1) * 86400000 + 9 * 3600000);
    dayStart.setUTCHours(0 - 9, 0, 0, 0); // JST 0時
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const count = await prisma.hourlyOptimizationSnapshot.count({
      where: { executionTime: { gte: dayStart, lt: dayEnd } },
    });
    const dateStr = dayStart.toISOString().substring(0, 10);
    console.log(`  ${dateStr}: ${count}件`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); prisma.$disconnect(); });
