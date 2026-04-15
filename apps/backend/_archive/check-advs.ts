import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const advs = await p.advertiser.findMany({ select: { name: true, tiktokAdvertiserId: true } });
  for (const a of advs) console.log(a.tiktokAdvertiserId, a.name);
  await p.$disconnect();
}
main();
