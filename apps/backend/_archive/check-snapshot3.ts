import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  // 1. CR01190の全SnapshotをadName部分一致で検索（adId問わず）
  const allCR01190 = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      adName: { contains: 'CR01190' },
      executionTime: {
        gte: new Date('2026-04-08T15:00:00Z'),
        lt: new Date('2026-04-09T15:00:00Z'),
      },
    },
    orderBy: { executionTime: 'asc' },
  });
  console.log(`CR01190のSnapshot: ${allCR01190.length}件`);

  // 2. AI_1 (7468288053866561553) の4/9全Snapshotの時間帯確認
  const ai1All = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      advertiserId: '7468288053866561553',
      executionTime: {
        gte: new Date('2026-04-08T15:00:00Z'),
        lt: new Date('2026-04-09T15:00:00Z'),
      },
    },
    orderBy: { executionTime: 'asc' },
  });

  console.log(`\nAI_1の4/9全Snapshot: ${ai1All.length}件`);

  // 時間帯別の件数
  const hourCounts = new Map<string, number>();
  const hourActions = new Map<string, Map<string, number>>();
  for (const s of ai1All) {
    const jst = new Date(s.executionTime.getTime() + 9 * 60 * 60 * 1000);
    const hourKey = jst.toISOString().slice(11, 13);
    hourCounts.set(hourKey, (hourCounts.get(hourKey) || 0) + 1);

    if (!hourActions.has(hourKey)) hourActions.set(hourKey, new Map());
    const actions = hourActions.get(hourKey)!;
    actions.set(s.action, (actions.get(s.action) || 0) + 1);
  }

  console.log('\nAI_1 時間帯別Snapshot件数:');
  for (const [hour, count] of [...hourCounts.entries()].sort()) {
    const actions = hourActions.get(hour)!;
    const actionStr = [...actions.entries()].map(([a, c]) => `${a}:${c}`).join(', ');
    console.log(`  ${hour}時: ${count}件 (${actionStr})`);
  }

  // 3. INCREASE判定がある広告を確認
  const increases = ai1All.filter(s => s.action === 'INCREASE');
  console.log(`\nINCREASE判定: ${increases.length}件`);
  for (const s of increases) {
    const jst = new Date(s.executionTime.getTime() + 9 * 60 * 60 * 1000);
    console.log(`  ${jst.toISOString().slice(11, 16)} | ${s.adName.slice(0, 50)} | budget=¥${s.dailyBudget} → ¥${s.newBudget}`);
  }

  // 4. ChangeLogでも確認
  const changeLogs = await prisma.changeLog.findMany({
    where: {
      action: 'UPDATE_BUDGET',
      createdAt: {
        gte: new Date('2026-04-08T15:00:00Z'),
        lt: new Date('2026-04-09T15:00:00Z'),
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\n=== ChangeLog (UPDATE_BUDGET) 4/9 ===`);
  console.log(`Total: ${changeLogs.length}件`);

  // CR01190関連のchangelogを抽出
  for (const cl of changeLogs) {
    const reason = cl.reason || '';
    const afterData = cl.afterData as any;
    const beforeData = cl.beforeData as any;
    if (reason.includes('CR01190') || (afterData && JSON.stringify(afterData).includes('CR01190'))) {
      const jst = new Date(cl.createdAt.getTime() + 9 * 60 * 60 * 1000);
      console.log(`  ${jst.toISOString().slice(11, 16)} | ${cl.entityType} ${cl.entityId} | ${cl.source} | ${reason.slice(0, 80)}`);
      if (beforeData?.budget || afterData?.budget) {
        console.log(`    budget: ${beforeData?.budget} → ${afterData?.budget}`);
      }
    }
  }

  // 5. V1のOptimizationResultも確認
  try {
    const v1Results = await prisma.$queryRaw`
      SELECT * FROM "optimization_results"
      WHERE "created_at" >= '2026-04-08T15:00:00Z'
      AND "created_at" < '2026-04-09T15:00:00Z'
      LIMIT 10
    `;
    console.log(`\n=== V1 OptimizationResult ===`);
    console.log(JSON.stringify(v1Results, null, 2));
  } catch (e) {
    console.log('\nV1 optimization_results table not found');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
