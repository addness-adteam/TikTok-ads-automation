import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();
const prisma = new PrismaClient();

async function main() {
  const adv = await prisma.advertiser.findUnique({
    where: { tiktokAdvertiserId: '7543540100849156112' },
  });
  console.log('SNS2:', JSON.stringify(adv, null, 2));
  await prisma.$disconnect();
}
main();
