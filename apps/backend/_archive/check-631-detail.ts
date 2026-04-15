import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  const prisma = new PrismaClient();
  const logs = await prisma.changeLog.findMany({
    where: { entityId: '1861071087963282' },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  for (const l of logs) {
    const jst = new Date(l.createdAt.getTime() + 9 * 3600000);
    const before = l.beforeData as any;
    const after = l.afterData as any;
    console.log(`${jst.toISOString().slice(0, 16)} | ${l.action} | before:¥${before?.budget ?? '?'} → after:¥${after?.budget ?? '?'} | ${l.reason || ''}`);
  }
  await prisma.$disconnect();
}
main();
