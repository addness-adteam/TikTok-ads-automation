import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  // Search by CR00568
  const ads = await p.ad.findMany({
    where: { name: { contains: 'CR00568' } },
    select: { tiktokId: true, name: true, status: true, adGroup: { select: { tiktokId: true, campaign: { select: { name: true, advertiserId: true, tiktokId: true } } } } }
  });
  console.log('=== CR00568 ads ===');
  for (const a of ads) console.log(a.tiktokId, '|', a.name, '|', a.status, '|', a.adGroup.campaign.advertiserId);

  // Also find by 説明しよう
  const ads2 = await p.ad.findMany({
    where: { name: { contains: '説明しよう' } },
    select: { tiktokId: true, name: true, status: true, adGroup: { select: { tiktokId: true, campaign: { select: { name: true, advertiserId: true, tiktokId: true } } } } }
  });
  console.log('=== 説明しよう ads ===');
  for (const a of ads2) console.log(a.tiktokId, '|', a.name, '|', a.status, '|', a.adGroup.campaign.advertiserId);

  // Get advertiser mapping
  const advs = await p.advertiser.findMany({
    select: { id: true, tiktokAdvertiserId: true, name: true }
  });
  console.log('=== Advertisers ===');
  for (const a of advs) console.log(a.id, '|', a.tiktokAdvertiserId, '|', a.name);

  await p.$disconnect();
}
main();
