import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const ads = await prisma.ad.findMany({
    where: { name: { contains: 'CR01207' } },
    select: { tiktokId: true, name: true, operationStatus: true, advertiserId: true },
  });
  console.log('=== Ads with CR01207 ===');
  for (const ad of ads) {
    console.log(`tiktokId: ${ad.tiktokId} | ${ad.name} | status: ${ad.operationStatus} | adv: ${ad.advertiserId}`);
  }

  // DB容量エラーでchangeLog記録できなかった可能性があるので、直接SQLで検索
  const rawLogs = await prisma.$queryRawUnsafe(`
    SELECT "createdAt", action, "entityId", reason
    FROM change_logs
    WHERE reason LIKE '%01207%' OR "entityId" LIKE '%01207%'
    ORDER BY "createdAt" DESC LIMIT 10
  `) as any[];
  console.log('\n=== ChangeLog with 01207 ===');
  for (const r of rawLogs) {
    console.log(`${r.createdAt} | ${r.action} | ${r.entityId} | ${r.reason?.slice(0, 120)}`);
  }

  await prisma.$disconnect();
}
main().catch(console.error);
