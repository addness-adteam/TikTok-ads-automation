import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
import { PrismaClient } from '@prisma/client';

async function main() {
  const p = new PrismaClient();
  const crs = ['CR01199','CR01200','CR01201','CR01202','CR01203'];
  for (const cr of crs) {
    const ads = await p.ad.findMany({
      where: { name: { contains: cr, mode: 'insensitive' } },
      select: { tiktokId: true, name: true, status: true, adGroup: { select: { campaign: { select: { advertiser: { select: { name: true, tiktokAdvertiserId: true } } } } } } },
    });
    for (const ad of ads) {
      console.log(`${cr} | ${ad.tiktokId} | ${ad.adGroup?.campaign?.advertiser?.name} (${ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId}) | ${ad.status} | ${ad.name}`);
    }
    if (ads.length === 0) console.log(`${cr} | NOT FOUND`);
  }
  await p.$disconnect();
}
main();
