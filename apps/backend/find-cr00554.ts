import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
const prisma = new PrismaClient();
async function main() {
  const adv = await prisma.advertiser.findUnique({
    where: { id: '8fa02c81-b8ff-41f9-9db1-f24e9532d609' },
    select: { id: true, tiktokAdvertiserId: true, name: true },
  });
  console.log('Source advertiser:', JSON.stringify(adv));

  const sp1 = await prisma.advertiser.findFirst({ where: { tiktokAdvertiserId: '7474920444831875080' }, select: { id: true, tiktokAdvertiserId: true, name: true } });
  const sp3 = await prisma.advertiser.findFirst({ where: { tiktokAdvertiserId: '7616545514662051858' }, select: { id: true, tiktokAdvertiserId: true, name: true } });
  console.log('SP1:', JSON.stringify(sp1));
  console.log('SP3:', JSON.stringify(sp3));

  await prisma.$disconnect();
}
main();
