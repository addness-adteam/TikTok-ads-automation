import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const ads = await prisma.$queryRawUnsafe(
    `SELECT tiktok_id, name, status, advertiser_id FROM ads WHERE name LIKE '%CR01207%'`
  ) as any[];
  console.log('=== Ads with CR01207 ===');
  for (const a of ads) console.log(`${a.tiktok_id} | ${a.name} | ${a.status} | adv:${a.advertiser_id}`);
  if (ads.length === 0) console.log('(none found in local DB)');

  const logs = await prisma.$queryRawUnsafe(
    `SELECT "createdAt", action, "entityId", reason FROM change_logs WHERE reason LIKE '%01207%' OR reason LIKE '%1207%' ORDER BY "createdAt" DESC LIMIT 10`
  ) as any[];
  console.log('\n=== ChangeLogs ===');
  for (const l of logs) console.log(`${l.createdAt} | ${l.action} | ${l.entityId} | ${(l.reason || '').slice(0, 120)}`);
  if (logs.length === 0) console.log('(none found - likely lost due to DB size error)');

  await prisma.$disconnect();
}
main().catch(console.error);
