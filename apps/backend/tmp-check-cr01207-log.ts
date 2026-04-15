import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // CrossDeployLogを検索
  const logs = await prisma.crossDeployLog.findMany({
    where: {
      OR: [
        { newAdName: { contains: 'CR01207' } },
        { newCampaignName: { contains: 'CR01207' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  if (logs.length === 0) {
    console.log('CrossDeployLogにCR01207なし → ローカルスクリプトで出稿された可能性');
  } else {
    for (const l of logs) {
      console.log(`created: ${l.createdAt?.toISOString()}`);
      console.log(`mode: ${l.mode}`);
      console.log(`sourceAdId: ${l.sourceAdId}`);
      console.log(`targetAdvertiserId: ${l.targetAdvertiserId}`);
      console.log(`newCampaignName: ${(l as any).newCampaignName}`);
      console.log(`newAdName: ${(l as any).newAdName}`);
      console.log(`status: ${l.status}`);
      console.log(`dailyBudget: ${(l as any).dailyBudget}`);
      console.log('---');
    }
  }

  // CrossDeployLogのスキーマを確認
  const allLogs = await prisma.crossDeployLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  console.log('\n最新3件のCrossDeployLog:');
  for (const l of allLogs) {
    console.log(JSON.stringify(l, null, 2));
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); });
