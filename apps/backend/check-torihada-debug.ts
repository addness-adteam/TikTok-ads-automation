import { PrismaClient } from '@prisma/client';
import { validateAdNameFormat } from './src/common/utils/optimization-error.util';

const prisma = new PrismaClient();

async function main() {
  const ads = await prisma.ad.findMany({
    where: {
      name: { contains: 'TORIHADA' },
    },
    select: {
      id: true,
      tiktokId: true,
      name: true,
      status: true,
    },
    orderBy: { name: 'asc' },
  });

  console.log(`\nTORIHADA広告: ${ads.length}件\n`);

  // ChangeLog確認（PAUSE + INTRADAY_PAUSE）
  const tiktokIds = ads.map(a => a.tiktokId);
  const logs = await prisma.changeLog.findMany({
    where: {
      entityType: 'AD',
      entityId: { in: tiktokIds },
      action: { in: ['PAUSE', 'INTRADAY_PAUSE'] },
    },
    select: {
      entityId: true,
      action: true,
      source: true,
      createdAt: true,
    },
  });
  const loggedIds = new Set(logs.map(l => l.entityId));

  // CR単位でグループ化
  const crMap = new Map<string, typeof ads>();
  for (const ad of ads) {
    const result = validateAdNameFormat(ad.name);
    const crName = result.parsed?.creativeName || ad.name;
    if (!crMap.has(crName)) crMap.set(crName, []);
    crMap.get(crName)!.push(ad);
  }

  console.log(`CR数: ${crMap.size}\n`);

  let pausedCRs = 0;
  for (const [crName, crAds] of crMap) {
    const adStatuses = crAds.map(ad => {
      const hasLog = loggedIds.has(ad.tiktokId);
      const isPaused = hasLog || ad.status.includes('DISABLE');
      return { ...ad, hasLog, isPaused };
    });
    const isFullyPaused = adStatuses.every(a => a.isPaused);
    if (isFullyPaused) pausedCRs++;

    console.log(`[${isFullyPaused ? 'PAUSED' : 'ACTIVE'}] CR: ${crName}`);
    for (const ad of adStatuses) {
      console.log(`  ${ad.isPaused ? '✓' : '✗'} status=${ad.status} log=${ad.hasLog ? 'あり' : 'なし'} | ${ad.name} (${ad.tiktokId})`);
    }
  }

  console.log(`\n停止率: ${pausedCRs}/${crMap.size} = ${Math.round(pausedCRs / crMap.size * 1000) / 10}%`);

  await prisma.$disconnect();
}

main().catch(console.error);
