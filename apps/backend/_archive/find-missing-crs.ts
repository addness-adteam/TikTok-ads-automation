import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();
async function main() {
  const crs = ['CR01161', 'CR01144', 'CR01165'];
  for (const cr of crs) {
    const ads = await prisma.ad.findMany({
      where: { name: { contains: cr } },
      select: { tiktokId: true, name: true, status: true, adGroup: { select: { campaign: { select: { advertiser: { select: { name: true, tiktokAdvertiserId: true } } } } } } },
    });
    if (ads.length === 0) {
      console.log(`${cr}: NOT IN DB`);
    } else {
      for (const ad of ads) {
        console.log(`${cr}: ${ad.adGroup.campaign.advertiser.name} (${ad.adGroup.campaign.advertiser.tiktokAdvertiserId}) | tiktokId=${ad.tiktokId} | status=${ad.status} | ${ad.name}`);
      }
    }
  }
  await prisma.$disconnect();
}
main();
