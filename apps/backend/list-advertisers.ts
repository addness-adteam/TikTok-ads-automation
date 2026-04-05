import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const advertisers = await prisma.advertiser.findMany({
    select: {
      id: true,
      name: true,
      tiktokAdvertiserId: true,
      status: true
    }
  });

  console.log('All Advertisers:');
  advertisers.forEach(adv => {
    console.log(`- ${adv.name} (${adv.tiktokAdvertiserId}) [${adv.status}]`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
