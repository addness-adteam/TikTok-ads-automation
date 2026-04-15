import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  const prisma = new PrismaClient();

  // change_logsからCR00631の広告グループ予算変更を探す
  const adGroupTiktokId = '1861071087963282';
  const adTiktokId = '1861071345538178';

  const changeLogs = await prisma.changeLog.findMany({
    where: { OR: [
      { entityId: adGroupTiktokId },
      { entityId: adTiktokId },
      { reason: { contains: 'CR00631' } },
    ]},
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  console.log('=== Change Logs ===');
  for (const l of changeLogs) {
    const jst = new Date(l.createdAt.getTime() + 9 * 3600000);
    console.log(`${jst.toISOString().slice(0, 16)} | ${l.entityType} ${l.entityId} | ${l.action} | ${l.description?.slice(0, 100)}`);
  }

  // ad_budget_capsから
  const caps = await prisma.adBudgetCap.findMany({
    where: { ad: { tiktokId: adTiktokId } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  console.log('\n=== Ad Budget Caps ===');
  for (const c of caps) {
    const jst = new Date(c.createdAt.getTime() + 9 * 3600000);
    console.log(`${jst.toISOString().slice(0, 16)} | dailyCap: ¥${c.dailyCap} | initialBudget: ¥${c.initialBudget}`);
  }

  // daily report sheetのCR00631行を確認
  // → API直接
  const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
  const ADV = '7543540100849156112';

  // adgroup updateの履歴をapi_logsから探す
  const apiLogs = await prisma.apiLog.findMany({
    where: { OR: [
      { requestBody: { contains: adGroupTiktokId } },
      { requestBody: { contains: '300000' } },
    ], endpoint: { contains: 'adgroup' } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { createdAt: true, endpoint: true, requestBody: true, responseCode: true },
  });
  console.log('\n=== API Logs (adgroup) ===');
  for (const l of apiLogs) {
    const jst = new Date(l.createdAt.getTime() + 9 * 3600000);
    console.log(`${jst.toISOString().slice(0, 16)} | ${l.endpoint} | code:${l.responseCode}`);
    console.log(`  body: ${l.requestBody?.slice(0, 200)}`);
  }

  await prisma.$disconnect();
}
main();
