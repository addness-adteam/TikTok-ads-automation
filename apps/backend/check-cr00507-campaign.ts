import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();
const p = new PrismaClient();
async function main() {
  const ad = await p.ad.findFirst({
    where: { name: { contains: 'LP2-CR00507' } },
    include: { adGroup: { include: { campaign: true } } },
  });
  if (ad) {
    console.log('Ad:', ad.name, '| tiktokId:', ad.tiktokId);
    console.log('Campaign:', ad.adGroup?.campaign?.name, '| objective:', ad.adGroup?.campaign?.objectiveType);
    console.log('AdGroup status:', ad.adGroup?.status);
  }
  // SP1の他の広告も比較（通常 vs Smart+）
  const sp1Ads = await p.$queryRaw<any[]>`
    SELECT a.name, a."tiktokId", c."objectiveType", c.name as camp_name
    FROM ads a
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    JOIN advertisers adv ON c."advertiserId" = adv.id
    WHERE adv."tiktokAdvertiserId" = '7474920444831875080'
      AND a.name LIKE '%LP2-CR00507%' OR a.name LIKE '%LP2-CR00468%' OR a.name LIKE '%LP2-CR00493%'
  `;
  console.log('\nSP1 比較:');
  for (const a of sp1Ads) {
    console.log(`  ${a.name} | objective: ${a.objectiveType} | campaign: ${a.camp_name}`);
  }
  await p.$disconnect();
}
main();
