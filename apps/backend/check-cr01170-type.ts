import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const ad = await p.ad.findFirst({ where: { tiktokId: '1861681678881889' }, include: { adGroup: { include: { campaign: true } } } });
  console.log('ad.name:', ad?.name);
  console.log('ad fields:', Object.keys(ad ?? {}));
  console.log('adGroup fields:', Object.keys(ad?.adGroup ?? {}));
  console.log('campaign fields:', Object.keys(ad?.adGroup?.campaign ?? {}));
  console.log('FULL ad:', JSON.stringify(ad, null, 2));
  await p.$disconnect();
})();
