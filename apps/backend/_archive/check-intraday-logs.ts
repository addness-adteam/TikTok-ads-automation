import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  const prisma = new PrismaClient();
  // ¥300,000のadgroupに対するintraday logsを確認
  const targets = ['1861321121627378', '1861474109205618', '1861681652908097'];
  
  const logs = await prisma.intradayBudgetReductionLog.findMany({
    where: { adgroupId: { in: targets } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  
  console.log('=== Intraday Budget Reduction Logs ===');
  for (const l of logs) {
    const jst = new Date(l.createdAt.getTime() + 9 * 3600000);
    console.log(`${jst.toISOString().slice(0, 16)} | ag:${l.adgroupId} | original:¥${l.originalBudget} → reduced:¥${l.reducedBudget} | restored:${l.restored} | restoreTime:${l.restoreTime?.toISOString().slice(0, 16) || '-'}`);
  }
  
  // 全体で最近のintradayログ
  const recent = await prisma.intradayBudgetReductionLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { createdAt: true, adgroupId: true, originalBudget: true, reducedBudget: true, restored: true },
  });
  console.log('\n=== 直近のIntraday Logs ===');
  for (const l of recent) {
    const jst = new Date(l.createdAt.getTime() + 9 * 3600000);
    console.log(`${jst.toISOString().slice(0, 16)} | ag:${l.adgroupId} | original:¥${l.originalBudget} → ¥${l.reducedBudget} | restored:${l.restored}`);
  }
  
  await prisma.$disconnect();
}
main();
