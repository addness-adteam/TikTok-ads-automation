import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // CR00619のadgroupのinitialBudgetを10000に更新（CR00622と同じキャンペーン構造）
  const result = await prisma.adGroup.update({
    where: { tiktokId: '1859793272644897' },
    data: { initialBudget: 10000 },
  });
  console.log(`更新完了: adgroup ${result.tiktokId} | initialBudget: ¥${result.initialBudget}`);

  // CR00622がsyncされた時用に、SNS2アカウントの今日入稿分も確認
  // → まだDBにないので、明日sync後に自動でinitialBudget=現在予算がセットされる

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
