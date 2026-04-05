import { PrismaClient } from './apps/backend/src/lib/prisma';

const prisma = new PrismaClient();

async function main() {
  // CR00734, CR00724, CR00733 を含む広告を検索
  const ads = await prisma.ad.findMany({
    where: {
      OR: [
        { name: { contains: 'CR00734' } },
        { name: { contains: 'CR00724' } },
        { name: { contains: 'CR00733' } },
      ]
    },
    select: {
      id: true,
      tiktokAdId: true,
      name: true,
      status: true,
    }
  });

  console.log('=== 対象広告 ===');
  for (const ad of ads) {
    console.log(`ID: ${ad.id} | TikTok ID: ${ad.tiktokAdId} | Status: ${ad.status}`);
    console.log(`  Name: ${ad.name}`);
  }

  // 各広告の停止ログを確認
  console.log('\n=== IntradayPauseLog (停止ログ) ===');
  for (const ad of ads) {
    const pauseLogs = await prisma.intradayPauseLog.findMany({
      where: { adId: ad.id },
      orderBy: { pauseTime: 'desc' },
      take: 5,
    });

    if (pauseLogs.length > 0) {
      const shortName = ad.name.slice(-10);
      console.log(`\n広告: ${shortName}`);
      for (const log of pauseLogs) {
        console.log(`  停止日時: ${log.pauseTime.toISOString()} | 理由: ${log.pauseReason} | 再開: ${log.resumed}`);
      }
    } else {
      console.log(`\n広告 ${ad.name.slice(-10)}: 停止ログなし`);
    }
  }

  // ChangeLogも確認
  console.log('\n=== ChangeLog (変更履歴) ===');
  for (const ad of ads) {
    const changeLogs = await prisma.changeLog.findMany({
      where: {
        entityType: 'AD',
        entityId: ad.id,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (changeLogs.length > 0) {
      const shortName = ad.name.slice(-10);
      console.log(`\n広告: ${shortName}`);
      for (const log of changeLogs) {
        const desc = log.description ? log.description.slice(0, 100) : '';
        console.log(`  ${log.createdAt.toISOString()} | ${log.action} | ${desc}`);
      }
    } else {
      console.log(`\n広告 ${ad.name.slice(-10)}: 変更ログなし`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
