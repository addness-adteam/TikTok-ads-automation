import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const crs = ['CR00745', 'CR00797', 'CR00807', 'CR00647', 'CR00518'];
  for (const cr of crs) {
    const ads = await prisma.ad.findMany({
      where: { name: { contains: cr } },
      select: {
        tiktokId: true,
        name: true,
        status: true,
        adGroup: {
          select: {
            campaign: {
              select: {
                advertiser: {
                  select: { tiktokAdvertiserId: true, name: true }
                }
              }
            }
          }
        }
      }
    });
    console.log(`\n=== ${cr} ===`);
    if (ads.length === 0) {
      console.log('  NOT FOUND in DB');
    }
    for (const ad of ads) {
      const advId = ad.adGroup.campaign.advertiser.tiktokAdvertiserId;
      const advName = ad.adGroup.campaign.advertiser.name;
      console.log(`  Ad ID: ${ad.tiktokId} | Status: ${ad.status} | Account: ${advName} (${advId})`);
      console.log(`  Name: ${ad.name}`);
    }
  }
  await prisma.$disconnect();
}
main();
