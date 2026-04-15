import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  // 1. AI_1の4/9 ChangeLog（UPDATE_BUDGET）を全件確認
  const budgetChanges = await prisma.changeLog.findMany({
    where: {
      action: 'UPDATE_BUDGET',
      createdAt: {
        gte: new Date('2026-04-08T15:00:00Z'),
        lt: new Date('2026-04-09T15:00:00Z'),
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`=== 4/9 UPDATE_BUDGET全件: ${budgetChanges.length}件 ===`);
  for (const cl of budgetChanges) {
    const jst = new Date(cl.createdAt.getTime() + 9 * 60 * 60 * 1000);
    const bd = cl.beforeData as any;
    const ad = cl.afterData as any;
    console.log(`${jst.toISOString().slice(11, 16)} | ${cl.entityType} ${cl.entityId} | ${bd?.budget} → ${ad?.budget} | ${(cl.reason || '').slice(0, 60)}`);
  }

  // 2. 4/9にCVがあった他の広告のSnapshot確認（CR01150, CR01144, CR01169）
  const crNames = ['CR01150', 'CR01144', 'CR01169', 'CR01163', 'CR01190'];
  for (const cr of crNames) {
    const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
      where: {
        adName: { contains: cr },
        advertiserId: '7468288053866561553',
        executionTime: {
          gte: new Date('2026-04-08T15:00:00Z'),
          lt: new Date('2026-04-09T15:00:00Z'),
        },
      },
      orderBy: { executionTime: 'asc' },
    });

    const increases = snaps.filter(s => s.action === 'INCREASE');
    const lastSnap = snaps[snaps.length - 1];
    const lastTime = lastSnap ? new Date(lastSnap.executionTime.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16) : 'N/A';

    console.log(`\n${cr}: ${snaps.length}件 | INCREASE: ${increases.length}件 | 最終: ${lastTime}`);
    if (increases.length > 0) {
      for (const s of increases) {
        const jst = new Date(s.executionTime.getTime() + 9 * 60 * 60 * 1000);
        console.log(`  ★ ${jst.toISOString().slice(11, 16)} | CV=${s.todayCVCount} | ¥${s.dailyBudget} → ¥${s.newBudget}`);
      }
    }
  }

  // 3. CR01190のキャンペーン/広告グループのbudget_modeを確認
  // まずadgroup IDを取得
  const ad = await prisma.ad.findFirst({
    where: { name: { contains: 'CR01190' } },
    include: {
      adGroup: {
        include: {
          campaign: true,
        },
      },
    },
  });

  if (ad) {
    console.log(`\n=== CR01190 広告情報 ===`);
    console.log(`ad tiktokId: ${ad.tiktokId}`);
    console.log(`ad name: ${ad.name}`);
    console.log(`adGroup tiktokId: ${ad.adGroup.tiktokId}`);
    console.log(`adGroup budgetMode: ${ad.adGroup.budgetMode}`);
    console.log(`adGroup budget: ${ad.adGroup.budget}`);
    console.log(`campaign tiktokId: ${ad.adGroup.campaign.tiktokId}`);
    console.log(`campaign budgetMode: ${ad.adGroup.campaign.budgetMode}`);
    console.log(`campaign budget: ${ad.adGroup.campaign.budget}`);
    console.log(`campaign budgetOptimizeOn: ${ad.adGroup.campaign.budgetOptimizeOn}`);
  }

  // 4. 比較用: CR01150のキャンペーン情報
  const ad2 = await prisma.ad.findFirst({
    where: { name: { contains: 'CR01150' } },
    include: {
      adGroup: {
        include: {
          campaign: true,
        },
      },
    },
  });

  if (ad2) {
    console.log(`\n=== CR01150 広告情報（比較用） ===`);
    console.log(`ad name: ${ad2.name}`);
    console.log(`adGroup budgetMode: ${ad2.adGroup.budgetMode}`);
    console.log(`campaign budgetMode: ${ad2.adGroup.campaign.budgetMode}`);
    console.log(`campaign budgetOptimizeOn: ${ad2.adGroup.campaign.budgetOptimizeOn}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
