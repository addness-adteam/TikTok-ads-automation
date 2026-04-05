import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  // BC ID 7440019834009829392 はAI_4から取得済み。全アカウント共通のBC。
  const bcId = '7440019834009829392';
  const result = await prisma.advertiser.updateMany({
    data: { identityAuthorizedBcId: bcId },
  });
  console.log(`${result.count}アカウント更新完了 (bc_id=${bcId})`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
