import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
const prisma = new PrismaClient();
async function main() {
  // CR01053 on AI_1
  const cr1053 = await prisma.ad.findMany({
    where: { name: { contains: 'CR01053' }, adGroup: { campaign: { advertiser: { is: { tiktokAdvertiserId: '7468288053866561553' } } } } },
    select: { tiktokId: true, name: true, status: true },
    take: 3
  });
  console.log('CR01053 (AI_1):', JSON.stringify(cr1053));

  // CR01059
  const cr1059 = await prisma.ad.findMany({
    where: { name: { contains: 'CR01059' } },
    select: { tiktokId: true, name: true, status: true, adGroup: { select: { campaign: { select: { advertiser: { select: { tiktokAdvertiserId: true } } } } } } },
    take: 5
  });
  console.log('CR01059:', JSON.stringify(cr1059));

  // CR00002
  const cr0002 = await prisma.ad.findMany({
    where: { name: { contains: 'CR00002' } },
    select: { tiktokId: true, name: true, status: true, adGroup: { select: { campaign: { select: { advertiser: { select: { tiktokAdvertiserId: true } } } } } } },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('CR00002:', JSON.stringify(cr0002));

  await prisma.$disconnect();
}
main();
