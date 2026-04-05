import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, 'apps/backend/.env') });

const prisma = new PrismaClient();

async function main() {
  for (const crNum of ['CR01065', 'CR01066', 'CR01053']) {
    console.log(`\n=== ${crNum} ===`);
    const ads = await prisma.ad.findMany({
      where: { name: { contains: crNum } },
      select: {
        tiktokId: true,
        name: true,
        status: true,
        adGroup: {
          select: {
            budget: true,
            campaign: {
              select: {
                advertiser: { select: { tiktokAdvertiserId: true, name: true } },
              },
            },
          },
        },
      },
    });
    for (const ad of ads) {
      const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId;
      const advName = ad.adGroup?.campaign?.advertiser?.name;
      console.log(`  ad_id: ${ad.tiktokId} | name: ${ad.name} | status: ${ad.status} | adv: ${advName}(${advId}) | budget: ${ad.adGroup?.budget}`);
    }
    if (ads.length === 0) console.log('  (not found in DB)');
  }
  await prisma.$disconnect();
}
main();
