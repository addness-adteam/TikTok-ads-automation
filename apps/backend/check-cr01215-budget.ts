import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { PrismaClient } from '@prisma/client';

async function main() {
  const p = new PrismaClient();
  const ads = await p.ad.findMany({
    where: { name: { contains: 'LP1-CR01215' } },
    include: { adGroup: { include: { campaign: { include: { advertiser: true } } } } },
  });
  console.log(`CR01215広告: ${ads.length}件\n`);
  for (const ad of ads) {
    const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId;
    console.log(`[${advId}] ad=${ad.tiktokId} status=${ad.status} | ${ad.name}`);
    console.log(`  adGroup tiktokId=${ad.adGroup?.tiktokId} budget=${(ad.adGroup as any)?.budget} initialBudget=${(ad.adGroup as any)?.initialBudget}`);
    console.log(`  adGroupStatus=${(ad.adGroup as any)?.status}`);
  }

  // 4/14〜4/15の該当広告のsnapshot推移
  console.log(`\n=== 4/14〜4/15 snapshot推移 (JST) ===`);
  const snaps = await p.hourlyOptimizationSnapshot.findMany({
    where: {
      adId: { in: ads.map(a => a.tiktokId) },
      executionTime: { gte: new Date('2026-04-13T15:00:00Z'), lt: new Date('2026-04-15T15:00:00Z') },
    },
    orderBy: { executionTime: 'asc' },
    select: { executionTime: true, action: true, dailyBudget: true, newBudget: true, todaySpend: true, todayCVCount: true, adId: true },
  });
  console.log('time(JST)         | adId(末尾)      | action    | dailyBudget | newBudget | todaySpend | todayCV');
  for (const s of snaps) {
    const jst = new Date(s.executionTime.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
    console.log(`${jst} | ${s.adId.slice(-10)} | ${(s.action ?? '').padEnd(9)} | ${String(s.dailyBudget).padStart(11)} | ${String(s.newBudget ?? '').padStart(9)} | ${String(s.todaySpend ?? 0).padStart(10)} | ${s.todayCVCount ?? 0}`);
  }

  // 4/14 0:00と4/15 0:00のbudget-reset ChangeLogを探す
  console.log(`\n=== ChangeLog (予算リセット系) ===`);
  const logs = await p.changeLog.findMany({
    where: {
      entityId: { in: ads.map(a => a.adGroup?.tiktokId ?? '') },
      createdAt: { gte: new Date('2026-04-13T15:00:00Z') },
      action: { in: ['BUDGET_RESET', 'BUDGET_UPDATE', 'BUDGET_INCREASE'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  for (const l of logs) {
    const jst = new Date(l.createdAt.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
    console.log(`${jst} | ${l.action} | ${l.entityId} | ${l.reason?.slice(0, 100) ?? ''}`);
  }

  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
