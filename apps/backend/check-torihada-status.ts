import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const ads = await prisma.ad.findMany({
    where: {
      name: { contains: 'TORIHADA' },
    },
    select: {
      tiktokId: true,
      name: true,
      status: true,
    },
    orderBy: { name: 'asc' },
  });

  console.log(`\nTORIHADA広告: ${ads.length}件\n`);
  for (const ad of ads) {
    console.log(`[${ad.status}] ${ad.name} (${ad.tiktokId})`);
  }

  // ChangeLogも確認
  const tiktokIds = ads.map(a => a.tiktokId);
  const logs = await prisma.changeLog.findMany({
    where: {
      entityType: 'AD',
      entityId: { in: tiktokIds },
      action: 'PAUSE',
    },
    select: {
      entityId: true,
      source: true,
      createdAt: true,
    },
  });

  console.log(`\nChangeLog PAUSE記録: ${logs.length}件`);
  const loggedIds = new Set(logs.map(l => l.entityId));

  console.log('\n--- 停止判定 ---');
  for (const ad of ads) {
    const hasLog = loggedIds.has(ad.tiktokId);
    const isDisable = ad.status === 'DISABLE';
    const isPaused = hasLog || isDisable;
    console.log(`${isPaused ? '✓停止' : '✗稼働'} | status=${ad.status} | log=${hasLog ? 'あり' : 'なし'} | ${ad.name}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
