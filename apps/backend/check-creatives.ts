import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkCreatives() {
  const creatives = await prisma.creative.findMany();
  console.log(`Found ${creatives.length} creatives in database:`);
  console.log(JSON.stringify(creatives, null, 2));
  await prisma.$disconnect();
}

checkCreatives().catch(console.error);
