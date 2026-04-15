import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { PrismaClient } from '@prisma/client';

async function main() {
  const p = new PrismaClient();
  const ads = await p.ad.findMany({
    where: { name: { contains: '再出稿' } },
    include: { adGroup: { include: { campaign: { include: { advertiser: true } } } } },
  });
  console.log(`再出稿広告: ${ads.length}件\n`);
  for (const ad of ads) {
    const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId;
    console.log(`  [${advId?.slice(-4)}] ${ad.tiktokId} | ${ad.name}`);
  }
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
