import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const sample = await prisma.adGroup.findFirst({ select: { id: true, budget: true, initialBudget: true } });
  console.log('AdGroup sample:', sample);
  const count = await prisma.adGroup.count({ where: { initialBudget: { not: null } } });
  const total = await prisma.adGroup.count();
  console.log(`initialBudget filled: ${count}/${total}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
