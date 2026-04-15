import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  // 1. 4/9のChangeLog全件を確認
  const changeLogs = await prisma.changeLog.findMany({
    where: {
      createdAt: {
        gte: new Date('2026-04-08T15:00:00Z'),
        lt: new Date('2026-04-09T15:00:00Z'),
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`=== 4/9 全ChangeLog: ${changeLogs.length}件 ===`);
  for (const cl of changeLogs) {
    const jst = new Date(cl.createdAt.getTime() + 9 * 60 * 60 * 1000);
    const timeStr = jst.toISOString().slice(0, 16).replace('T', ' ');
    console.log(`${timeStr} | ${cl.entityType} ${cl.entityId} | ${cl.action} | ${cl.source} | ${(cl.reason || '').slice(0, 80)}`);
    const bd = cl.beforeData as any;
    const ad = cl.afterData as any;
    if (bd?.budget || ad?.budget) {
      console.log(`  budget: ${bd?.budget} → ${ad?.budget}`);
    }
  }

  // 2. Vercelのサーバーログはないので、V2のexecute-allエンドポイントを確認
  // → 代わりに、V2が03:27以降走ったか確認するために他のadvertiserのSnapshotを確認
  const otherSnapshots = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      advertiserId: { not: '7468288053866561553' },
      executionTime: {
        gte: new Date('2026-04-08T23:00:00Z'), // JST 08:00
        lt: new Date('2026-04-09T15:00:00Z'),
      },
    },
    select: {
      advertiserId: true,
      executionTime: true,
    },
    orderBy: { executionTime: 'asc' },
    take: 5,
  });

  console.log(`\n=== 他アカウントの08:00以降Snapshot (AI_1以外) ===`);
  for (const s of otherSnapshots) {
    const jst = new Date(s.executionTime.getTime() + 9 * 60 * 60 * 1000);
    console.log(`  ${jst.toISOString().slice(0, 16)} | ${s.advertiserId}`);
  }

  // 3. AI_1の最後のSnapshotの時間を確認
  const lastSnapshot = await prisma.hourlyOptimizationSnapshot.findFirst({
    where: { advertiserId: '7468288053866561553' },
    orderBy: { executionTime: 'desc' },
  });

  if (lastSnapshot) {
    const jst = new Date(lastSnapshot.executionTime.getTime() + 9 * 60 * 60 * 1000);
    console.log(`\nAI_1の最新Snapshot: ${jst.toISOString().slice(0, 16)} JST`);
    console.log(`  adName: ${lastSnapshot.adName}`);
    console.log(`  action: ${lastSnapshot.action}`);
  }

  // 4. 08:00-15:00のAI_1 Snapshot（存在するか）
  const ai1AfterEight = await prisma.hourlyOptimizationSnapshot.count({
    where: {
      advertiserId: '7468288053866561553',
      executionTime: {
        gte: new Date('2026-04-08T23:00:00Z'), // JST 08:00
        lt: new Date('2026-04-09T15:00:00Z'),  // JST 24:00
      },
    },
  });
  console.log(`\nAI_1の08:00以降Snapshot数: ${ai1AfterEight}件`);

  await prisma.$disconnect();
}

main().catch(console.error);
