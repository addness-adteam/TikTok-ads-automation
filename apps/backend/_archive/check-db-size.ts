import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRawUnsafe(`
    SELECT schemaname, tablename,
           pg_size_pretty(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))) as total_size,
           pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename)) as size_bytes
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename)) DESC
  `) as any[];

  console.log('=== Table sizes ===');
  for (const row of result) {
    console.log(`${row.tablename}: ${row.total_size} (${Number(row.size_bytes)} bytes)`);
  }

  // DB total
  const dbSize = await prisma.$queryRawUnsafe(`SELECT pg_size_pretty(pg_database_size(current_database())) as db_size`) as any[];
  console.log('\nDB total:', dbSize[0].db_size);

  // ChangeLog stats
  const count = await prisma.changeLog.count();
  const oldest = await prisma.changeLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
  const newest = await prisma.changeLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  console.log(`\nChangeLog: ${count} records, ${oldest?.createdAt} ~ ${newest?.createdAt}`);

  await prisma.$disconnect();
}

main().catch(console.error);
