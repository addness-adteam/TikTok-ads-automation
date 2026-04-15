import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  const prisma = new PrismaClient();

  // リセット失敗ログを探す
  console.log('=== RESET_BUDGET_ERROR ログ ===');
  const errors = await prisma.changeLog.findMany({
    where: { action: { contains: 'RESET' } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  for (const l of errors) {
    const jst = new Date(l.createdAt.getTime() + 9 * 3600000);
    const before = l.beforeData as any;
    const after = l.afterData as any;
    const hasError = l.action.includes('ERROR') || after?.error;
    if (hasError) {
      console.log(`❌ ${jst.toISOString().slice(0, 16)} | ${l.action} | ¥${before?.budget} → ¥${after?.budget} | ${after?.error || ''} | ${l.reason?.slice(0, 100)}`);
    }
  }

  // ¥300,000の広告グループのリセットログを確認
  console.log('\n=== ¥300,000広告グループのリセット履歴 ===');
  const targetAgs = ['1861321121627378', '1861474109205618', '1861681652908097', '1861895774239058'];
  for (const agId of targetAgs) {
    const logs = await prisma.changeLog.findMany({
      where: { entityId: agId },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`\n--- ag:${agId} (${logs.length}件) ---`);
    for (const l of logs) {
      const jst = new Date(l.createdAt.getTime() + 9 * 3600000);
      const before = l.beforeData as any;
      const after = l.afterData as any;
      console.log(`${jst.toISOString().slice(0, 16)} | ${l.action.padEnd(20)} | ¥${String(before?.budget ?? '?').padStart(6)} → ¥${String(after?.budget ?? '?').padStart(6)} | ${l.reason?.slice(0, 80) || ''}`);
    }
  }

  await prisma.$disconnect();
}
main();
