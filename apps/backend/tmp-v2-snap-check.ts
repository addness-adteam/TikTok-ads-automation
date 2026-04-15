import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    // 接続テスト
    await prisma.$queryRaw`SELECT 1`;
    console.log('DB接続OK\n');
  } catch (e: any) {
    console.error('DB接続エラー:', e.message);
    console.log('\nDATABASE_URL:', process.env.DATABASE_URL?.substring(0, 50) + '...');
    return;
  }

  // 今日のスナップショット
  const todayStart = new Date('2026-04-11T00:00:00+09:00');
  const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      executionTime: { gte: todayStart },
      adName: { contains: 'CR01207' },
    },
    orderBy: { executionTime: 'asc' },
  });

  console.log(`=== CR01207 今日のスナップショット: ${snaps.length}件 ===\n`);
  for (const s of snaps) {
    console.log(`${s.executionTime.toISOString()} | ${s.action} | CV:${s.todayCVCount} | CPA:${s.todayCPA} | spend:${s.todaySpend} | budget:${s.dailyBudget} → ${s.newBudget} | ${s.reason}`);
  }

  // AI_2の今日の全スナップショット
  console.log('\n=== AI_2 今日の全スナップショット ===');
  const allSnaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      advertiserId: '7523128243466551303',
      executionTime: { gte: todayStart },
    },
    orderBy: { executionTime: 'asc' },
  });
  console.log(`件数: ${allSnaps.length}`);
  const byAd = new Map<string, typeof allSnaps>();
  for (const s of allSnaps) {
    if (!byAd.has(s.adId)) byAd.set(s.adId, []);
    byAd.get(s.adId)!.push(s);
  }
  for (const [adId, snaps] of byAd) {
    const last = snaps[snaps.length - 1];
    console.log(`  ${adId} | ${snaps.length}回 | 最終: ${last.action} CV:${last.todayCVCount} budget:${last.dailyBudget}→${last.newBudget} | ${last.adName}`);
  }

  // 直近7日のV2実行回数
  console.log('\n=== 日別V2実行回数 ===');
  for (let i = 0; i < 7; i++) {
    const dayStart = new Date(new Date('2026-04-11T00:00:00+09:00').getTime() - i * 86400000);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const count = await prisma.hourlyOptimizationSnapshot.count({
      where: { executionTime: { gte: dayStart, lt: dayEnd } },
    });
    console.log(`  ${dayStart.toISOString().substring(0, 10)}: ${count}件`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); prisma.$disconnect(); });
