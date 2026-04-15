/**
 * V2スナップショット保存の検証スクリプト
 * デプロイ後に実行して、スナップショットが正しく保存されているか確認
 *
 * npx tsx apps/backend/verify-v2-snapshot.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== V2スナップショット保存検証 ===\n');

  // DB接続テスト
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('DB接続: OK\n');
  } catch (e: any) {
    console.error('DB接続エラー:', e.message);
    return;
  }

  // 直近のスナップショット
  const latest = await prisma.hourlyOptimizationSnapshot.findMany({
    orderBy: { executionTime: 'desc' },
    take: 5,
  });

  if (latest.length === 0) {
    console.log('⚠ スナップショットが0件（まだV2が実行されていない可能性）');
  } else {
    const lastTime = latest[0].executionTime;
    const ageMinutes = Math.floor((Date.now() - lastTime.getTime()) / 60000);
    console.log(`最新スナップショット: ${lastTime.toISOString()} (${ageMinutes}分前)`);

    if (ageMinutes > 120) {
      console.log(`⚠ 2時間以上前 → V2が停止している可能性`);
    } else {
      console.log(`✅ 正常（${ageMinutes}分前に実行）`);
    }
  }

  // 日別件数（直近5日）
  console.log('\n日別スナップショット件数:');
  for (let i = 0; i < 5; i++) {
    const dayStart = new Date(Date.now() + 9 * 3600000 - i * 86400000);
    dayStart.setUTCHours(-9, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const count = await prisma.hourlyOptimizationSnapshot.count({
      where: { executionTime: { gte: dayStart, lt: dayEnd } },
    });
    const dateStr = dayStart.toISOString().substring(0, 10);
    const status = count > 0 ? '✅' : '⚠';
    console.log(`  ${dateStr}: ${count}件 ${status}`);
  }

  // 今日のINCREASEアクション
  const todayStart = new Date();
  todayStart.setUTCHours(-9, 0, 0, 0);
  const increases = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      executionTime: { gte: todayStart },
      action: 'INCREASE',
    },
    orderBy: { executionTime: 'asc' },
  });

  if (increases.length > 0) {
    console.log(`\n今日のINCREASE: ${increases.length}件`);
    for (const s of increases) {
      console.log(`  ${s.executionTime.toISOString()} | ${s.adName} | CV:${s.todayCVCount} | ¥${s.dailyBudget}→¥${s.newBudget}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); });
