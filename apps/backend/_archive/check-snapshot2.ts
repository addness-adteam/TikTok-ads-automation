import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  // CR01190の全Snapshotを取得（4/9の全時間帯）
  const snapshots = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      adName: { contains: 'CR01190' },
      executionTime: {
        gte: new Date('2026-04-08T15:00:00Z'), // JST 4/9 00:00
        lt: new Date('2026-04-09T15:00:00Z'),   // JST 4/10 00:00
      },
    },
    orderBy: { executionTime: 'asc' },
  });

  console.log(`=== CR01190 全Snapshot (4/9 JST) ===`);
  console.log(`Total: ${snapshots.length}件\n`);

  // adId別にグルーピング
  const byAdId = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const list = byAdId.get(s.adId) || [];
    list.push(s);
    byAdId.set(s.adId, list);
  }

  console.log(`異なるadId数: ${byAdId.size}`);
  for (const [adId, snaps] of byAdId.entries()) {
    console.log(`\n--- adId: ${adId} (${snaps.length}件) ---`);
    let increaseCount = 0;
    for (const s of snaps) {
      const jst = new Date(s.executionTime.getTime() + 9 * 60 * 60 * 1000);
      const timeStr = jst.toISOString().slice(11, 16);
      const marker = s.action === 'INCREASE' ? '★' : ' ';
      if (s.action === 'INCREASE') increaseCount++;
      console.log(
        `${marker} ${timeStr} | CV=${s.todayCVCount} | spend=¥${s.todaySpend?.toFixed(0)} | budget=¥${s.dailyBudget?.toFixed(0)} → ${s.newBudget ? '¥' + s.newBudget.toFixed(0) : '-'} | ${s.action} | ${(s.reason || '').slice(0, 60)}`
      );
    }
    console.log(`→ INCREASE回数: ${increaseCount}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
