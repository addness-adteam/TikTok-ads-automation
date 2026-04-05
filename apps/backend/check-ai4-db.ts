import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const adv = await p.advertiser.findFirst({ where: { tiktokAdvertiserId: '7580666710525493255' } });
  console.log('Advertiser:', adv?.id, adv?.name);

  if (!adv) { console.log('NOT FOUND'); return; }

  const camps = await p.campaign.count({ where: { advertiserId: adv.id } });
  console.log('Campaigns:', camps);

  const adgroups = await p.adGroup.count({
    where: { campaign: { advertiserId: adv.id } },
  });
  console.log('AdGroups:', adgroups);

  const ads = await p.ad.count({
    where: { adGroup: { campaign: { advertiserId: adv.id } } },
  });
  console.log('Ads:', ads);

  const metrics = await p.$queryRaw<any[]>`
    SELECT count(*) as cnt FROM metrics m
    JOIN ads a ON m."adId" = a.id
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    WHERE c."advertiserId" = ${adv.id}
  `;
  console.log('Metrics:', metrics[0].cnt);

  // ENABLE広告
  const enableAds = await p.$queryRaw<any[]>`
    SELECT a.name, a."tiktokId", a.status
    FROM ads a
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    WHERE c."advertiserId" = ${adv.id} AND a.status = 'ENABLE'
  `;
  console.log(`\nENABLE ads (${enableAds.length}):`);
  for (const a of enableAds) {
    console.log(`  ${a.name} (${a.tiktokId})`);
  }

  await p.$disconnect();
}
main();
