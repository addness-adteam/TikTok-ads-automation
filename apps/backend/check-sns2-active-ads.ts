import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // SNS2の全スナップショット（最新）を確認
  const allSnapshots = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      advertiserId: '7543540100849156112',
    },
    orderBy: { executionTime: 'desc' },
    take: 20,
  });

  console.log(`=== SNS2 最近のスナップショット: ${allSnapshots.length}件 ===`);
  for (const s of allSnapshots) {
    console.log(`[${s.executionTime.toISOString()}] ${s.adName} → ${s.action}: ${s.reason}`);
  }

  // 「問題ないです」を含む広告名を検索
  const targetSnapshots = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      adName: { contains: '村上幸太朗' },
    },
    orderBy: { executionTime: 'desc' },
    take: 10,
  });

  console.log(`\n=== 村上幸太朗 関連スナップショット: ${targetSnapshots.length}件 ===`);
  for (const s of targetSnapshots) {
    console.log(`[${s.executionTime.toISOString()}] advertiser=${s.advertiserId} ${s.adName} → ${s.action}: ${s.reason}`);
    console.log(`  budget: ¥${s.dailyBudget}, spend: ¥${s.todaySpend}, cv: ${s.todayCV}, cpa: ${s.todayCPA}`);
  }

  // CR29527を含む広告名を検索
  const crSnapshots = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      adName: { contains: 'CR29527' },
    },
    orderBy: { executionTime: 'desc' },
    take: 10,
  });

  console.log(`\n=== CR29527 関連スナップショット: ${crSnapshots.length}件 ===`);
  for (const s of crSnapshots) {
    console.log(`[${s.executionTime.toISOString()}] advertiser=${s.advertiserId} ${s.adName} → ${s.action}: ${s.reason}`);
  }

  // SNS2のappealを確認
  const advertiser = await prisma.advertiser.findUnique({
    where: { tiktokAdvertiserId: '7543540100849156112' },
    include: { appeal: true },
  });
  console.log(`\n=== SNS2 Advertiser ===`);
  console.log(`appeal: ${advertiser?.appeal?.name}, targetCPA: ${advertiser?.appeal?.targetCPA}`);
  console.log(`isSmartPlus: ${advertiser?.appeal?.isSmartPlus}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
