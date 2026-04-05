import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();
const p = new PrismaClient();
async function main() {
  for (const id of ['7523128243466551303', '7543540647266074641']) {
    const a = await p.advertiser.findUnique({ where: { tiktokAdvertiserId: id } });
    console.log(`${a?.name}: pixel=${a?.pixelId}, identity=${a?.identityId}, bcId=${a?.identityAuthorizedBcId}`);
  }
  await p.$disconnect();
}
main();
