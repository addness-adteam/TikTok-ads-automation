import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const adTiktokId = '1861681678881889'; // CR01170 AI_2

  const ad = await prisma.ad.findFirst({
    where: { tiktokId: adTiktokId },
    include: { adGroup: { include: { campaign: true } } },
  });
  console.log('Ad:', ad?.name, '| status:', ad?.operationStatus, '| adGroup:', ad?.adGroup?.tiktokId, '| campaign:', ad?.adGroup?.campaign?.tiktokId);
  console.log('Advertiser:', ad?.adGroup?.campaign?.advertiserId);

  if (!ad) { await prisma.$disconnect(); return; }

  // Snapshots for this ad (4/11-4/14)
  const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      adId: adTiktokId,
      executionTime: { gte: new Date('2026-04-10T15:00:00Z'), lt: new Date('2026-04-14T15:00:00Z') },
    },
    orderBy: { executionTime: 'asc' },
    select: { executionTime: true, action: true, dailyBudget: true, newBudget: true, todaySpend: true, todayCVCount: true, todayCPA: true, adName: true },
  });

  console.log(`\nSnapshots: ${snaps.length}件`);
  console.log('time(JST)         | action    | dailyBudget | newBudget | todaySpend | todayCV | todayCPA');
  for (const s of snaps) {
    const jst = new Date(s.executionTime.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
    console.log(`${jst} | ${(s.action ?? '').padEnd(9)} | ${String(s.dailyBudget).padStart(11)} | ${String(s.newBudget ?? '').padStart(9)} | ${String(s.todaySpend ?? 0).padStart(10)} | ${String(s.todayCVCount ?? 0).padStart(7)} | ${String(s.todayCPA ?? '').padStart(8)}`);
  }

  // Daily Metric for this ad
  console.log(`\n=== DB Metric (ad) ===`);
  const metrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      adId: ad.id,
      statDate: { gte: new Date('2026-04-11'), lt: new Date('2026-04-15') },
    },
    orderBy: { statDate: 'asc' },
    select: { statDate: true, spend: true, impressions: true, conversions: true },
  });
  for (const m of metrics) {
    console.log(`${m.statDate.toISOString().slice(0, 10)} | spend=¥${m.spend} | imp=${m.impressions} | conv=${m.conversions}`);
  }

  // Check adGroup metrics (since INCREASE operates on adgroup level)
  console.log(`\n=== DB Metric (adGroup ${ad.adGroup?.tiktokId}) ===`);
  const agMetrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD_GROUP',
      adGroupId: ad.adGroupId,
      statDate: { gte: new Date('2026-04-11'), lt: new Date('2026-04-15') },
    },
    orderBy: { statDate: 'asc' },
    select: { statDate: true, spend: true, impressions: true, conversions: true },
  });
  for (const m of agMetrics) {
    console.log(`${m.statDate.toISOString().slice(0, 10)} | spend=¥${m.spend} | imp=${m.impressions} | conv=${m.conversions}`);
  }

  // 他の同一adGroup内の広告
  console.log(`\n=== 同adGroup内の他広告 ===`);
  const siblings = await prisma.ad.findMany({
    where: { adGroupId: ad.adGroupId },
    select: { tiktokId: true, name: true, operationStatus: true },
  });
  for (const s of siblings) console.log(`  ${s.tiktokId} | ${s.operationStatus} | ${s.name}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
