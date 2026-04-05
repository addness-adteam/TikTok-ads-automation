import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();
const prisma = new PrismaClient();

async function main() {
  // 1. registrationPathで探す
  const metrics = await prisma.metric.findMany({
    where: { registrationPath: { contains: 'CR00033' } },
    select: { registrationPath: true, campaignId: true, adId: true, adgroupId: true },
    take: 5,
  });
  console.log('registrationPathにCR00033:', metrics.length, '件');
  for (const m of metrics) console.log(m);

  // 2. AdPerformanceで探す
  const perfs = await (prisma.adPerformance as any).findMany({
    where: { registrationPath: { contains: 'CR00033' } },
    take: 5,
  }).catch(() => []);
  console.log('\nAdPerformanceにCR00033:', perfs.length, '件');

  // 3. SNSアカウントのキャンペーン一覧
  const snsAdvs = await prisma.advertiser.findMany({
    where: { tiktokAdvertiserId: { in: ['7247073333517238273','7543540100849156112','7543540381615800337'] } },
  });

  for (const adv of snsAdvs) {
    const campaigns = await prisma.campaign.findMany({
      where: { advertiserId: adv.id },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });
    console.log(`\n${adv.name} (${adv.tiktokAdvertiserId}) - ${campaigns.length}キャンペーン:`);
    for (const c of campaigns) {
      console.log(`  ${c.name?.substring(0, 70)} | ${c.objectiveType} | ${c.tiktokCampaignId}`);
    }
  }

  // 4. LP2-CR00033を含む広告を全アカウントで探す
  const ads = await prisma.$queryRaw<any[]>`
    SELECT a.name, c.name as "cName", adv.name as "advName", adv."tiktokAdvertiserId" as "advId"
    FROM ads a
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    JOIN advertisers adv ON c."advertiserId" = adv.id
    WHERE a.name LIKE '%CR00033%'
    LIMIT 10
  `;
  console.log('\n広告名にCR00033:', ads.length, '件');
  for (const a of ads) console.log(`  ${a.advName} | ${a.cName?.substring(0,50)} | ${a.name?.substring(0,50)}`);

  // 5. SNS LP2を含むSmart+っぽいキャンペーン
  for (const adv of snsAdvs) {
    const campaigns = await prisma.campaign.findMany({
      where: {
        advertiserId: adv.id,
        OR: [
          { name: { contains: 'LP2' } },
          { name: { contains: 'スマ' } },
          { name: { contains: 'Smart' } },
          { name: { contains: 'ガチャ' } },
        ],
      },
    });
    if (campaigns.length > 0) {
      console.log(`\n${adv.name} LP2/Smart+関連キャンペーン:`);
      for (const c of campaigns) {
        console.log(`  ${c.name?.substring(0, 70)} | ${c.tiktokCampaignId}`);
      }
    }
  }

  await prisma.$disconnect();
}
main().catch(console.error);
