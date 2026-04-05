import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const ads = await prisma.ad.findMany({
    where: {
      name: { contains: 'LP4-CR00003' },
    },
    select: {
      tiktokId: true,
      name: true,
      status: true,
      adGroup: {
        select: {
          campaign: {
            select: {
              advertiser: { select: { tiktokAdvertiserId: true, name: true } }
            }
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  for (const ad of ads) {
    const adv = ad.adGroup.campaign.advertiser;
    console.log(`ad_id: ${ad.tiktokId} | status: ${ad.status} | adv: ${adv.tiktokAdvertiserId} (${adv.name}) | name: ${ad.name}`);
  }
  await prisma.$disconnect();
}
main();
