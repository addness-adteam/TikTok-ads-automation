import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // changeLogからCR01207関連の停止ログを検索
  const logs = await prisma.changeLog.findMany({
    where: {
      OR: [
        { reason: { contains: '01207' } },
        { reason: { contains: 'CR01207' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  if (logs.length > 0) {
    console.log('=== ChangeLog entries ===');
    for (const log of logs) {
      console.log(`${log.createdAt} | ${log.action} | ${log.entityType}:${log.entityId} | ${log.reason}`);
    }
  } else {
    console.log('No changeLog entries found');
  }

  // adsテーブルからCR01207を検索
  const ads = await prisma.ad.findMany({
    where: { name: { contains: 'CR01207' } },
    select: { tiktokAdId: true, name: true, operationStatus: true, advertiserId: true },
  });

  if (ads.length > 0) {
    console.log('\n=== Ads matching CR01207 ===');
    for (const ad of ads) {
      console.log(`ad_id: ${ad.tiktokAdId} | ${ad.name} | status: ${ad.operationStatus} | adv: ${ad.advertiserId}`);
    }
  } else {
    console.log('\nNo ads found with CR01207');
  }

  // 最近のPAUSEアクション（DB容量エラーでログ記録に失敗した可能性）
  const recentPauses = await prisma.changeLog.findMany({
    where: {
      action: 'PAUSE',
      createdAt: { gte: new Date('2026-04-10') },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  console.log(`\n=== Recent PAUSE logs (since 4/10) === (${recentPauses.length} found)`);
  for (const log of recentPauses) {
    console.log(`${log.createdAt} | ${log.entityId} | ${log.reason?.slice(0, 100)}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
