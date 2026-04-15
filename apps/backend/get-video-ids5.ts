import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    // CR00588 and CR00591 from DB
    for (const search of ['CR00588', 'CR00591']) {
      const ads = await prisma.ad.findMany({
        where: { AND: [{ name: { contains: search } }, { name: { contains: 'LP2' } }] },
        include: {
          creative: true,
          adGroup: { include: { campaign: { include: { advertiser: { select: { tiktokAdvertiserId: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 3,
      });
      for (const ad of ads) {
        const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId;
        console.log(`${ad.name} | tiktokId: ${ad.tiktokId} | account: ${advId} | videoId: ${ad.creative?.tiktokVideoId || 'N/A'}`);
      }
    }

    // Also check CR00585's video info
    const cr585 = await prisma.ad.findMany({
      where: { AND: [{ name: { contains: 'CR00585' } }, { name: { contains: 'LP2' } }] },
      include: { creative: true },
      take: 3,
    });
    for (const ad of cr585) {
      console.log(`${ad.name} | tiktokId: ${ad.tiktokId} | videoId: ${ad.creative?.tiktokVideoId || 'N/A'}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
