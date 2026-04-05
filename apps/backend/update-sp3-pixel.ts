import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();
const prisma = new PrismaClient();
async function main() {
  await prisma.advertiser.update({
    where: { tiktokAdvertiserId: '7616545514662051858' },
    data: { pixelId: '7617659343252586503' },
  });
  const adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: '7616545514662051858' } });
  console.log('SP3 pixelId updated to:', adv?.pixelId);
  await prisma.$disconnect();
}
main();
