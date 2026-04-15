import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // PrismaはデフォルトでcamelCase→snake_caseマッピングしないので、@@mapを確認
  const ads = await prisma.$queryRawUnsafe(
    `SELECT * FROM ads WHERE name LIKE '%CR01207%'`
  ) as any[];
  console.log('=== Ads with CR01207 ===', ads.length);
  for (const a of ads) console.log(JSON.stringify(a));

  // changeLogで最近のPAUSE（4/10以降）を確認
  const recentPauses = await prisma.$queryRawUnsafe(`
    SELECT "createdAt", action, "entityId", substring(reason, 1, 150) as reason
    FROM change_logs
    WHERE action = 'PAUSE' AND "createdAt" >= '2026-04-10'
    ORDER BY "createdAt" DESC LIMIT 20
  `) as any[];
  console.log(`\n=== Recent PAUSEs since 4/10 (${recentPauses.length}) ===`);
  for (const l of recentPauses) console.log(`${l.createdAt} | ${l.entityId} | ${l.reason}`);

  await prisma.$disconnect();
}
main().catch(console.error);
