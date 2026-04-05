import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  
  const result = await prisma.metric.deleteMany({});
  console.log(`Deleted ${result.count} metrics`);
  
  await prisma.$disconnect();
}

main().catch(console.error);
