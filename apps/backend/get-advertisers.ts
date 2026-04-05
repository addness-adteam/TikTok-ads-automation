import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getAdvertisers() {
  const advertisers = await prisma.advertiser.findMany({
    select: {
      id: true,
      tiktokAdvertiserId: true,
      name: true,
    },
  });

  console.log('Advertisers in database:');
  advertisers.forEach(a => {
    console.log(`  UUID: ${a.id}`);
    console.log(`  TikTok ID: ${a.tiktokAdvertiserId}`);
    console.log(`  Name: ${a.name}`);
    console.log('');
  });

  await prisma.$disconnect();
}

getAdvertisers().catch(console.error);
