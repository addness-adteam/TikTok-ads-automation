import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.crossDeployLog.findMany({
    where: { adName: { contains: 'CR01207' } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  if (logs.length === 0) {
    console.log('CrossDeployLogにCR01207なし');
    // crNumberで検索
    const logs2 = await prisma.crossDeployLog.findMany({
      where: { crNumber: 1207 },
      take: 5,
    });
    if (logs2.length > 0) {
      for (const l of logs2) console.log(JSON.stringify(l, null, 2));
    } else {
      console.log('crNumber 1207もなし → ローカルスクリプトで出稿（DBログなし）');
      // 最新のログでbudget確認
      const recent = await prisma.crossDeployLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 3,
      });
      console.log('\n最新3件:');
      for (const l of recent) {
        console.log(`  ${l.createdAt.toISOString()} | budget:${l.dailyBudget} | ${l.adName} | ${l.status}`);
      }
    }
  } else {
    for (const l of logs) {
      console.log(`dailyBudget: ${l.dailyBudget}`);
      console.log(`adName: ${l.adName}`);
      console.log(`status: ${l.status}`);
      console.log(JSON.stringify(l, null, 2));
    }
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); prisma.$disconnect(); });
