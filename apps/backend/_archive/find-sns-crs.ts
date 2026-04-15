import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();
const prisma = new PrismaClient();

async function main() {
  const crNumbers = ['CR00579', 'CR00567', 'CR00566'];

  for (const cr of crNumbers) {
    console.log(`\n=== ${cr} ===`);

    // 広告名で検索
    const ads = await prisma.$queryRaw<any[]>`
      SELECT a.name as "adName", a."tiktokId", a.status, a."landingPageUrl",
             ag.name as "agName", c.name as "cName",
             adv.name as "advName", adv."tiktokAdvertiserId" as "advId"
      FROM ads a
      JOIN adgroups ag ON a."adgroupId" = ag.id
      JOIN campaigns c ON ag."campaignId" = c.id
      JOIN advertisers adv ON c."advertiserId" = adv.id
      WHERE (a.name LIKE ${'%' + cr + '%'} OR c.name LIKE ${'%' + cr + '%'})
        AND adv."tiktokAdvertiserId" IN ('7247073333517238273','7543540100849156112','7543540381615800337')
    `;

    for (const a of ads) {
      console.log(`  Account: ${a.advName} (${a.advId})`);
      console.log(`  Campaign: ${a.cName}`);
      console.log(`  AdGroup: ${a.agName}`);
      console.log(`  Ad: ${a.adName} | tiktokId: ${a.tiktokId} | status: ${a.status}`);
      console.log(`  LP: ${a.landingPageUrl}`);
      console.log('');
    }

    // registrationPathでも確認
    const metrics = await prisma.metric.findMany({
      where: { registrationPath: { contains: cr } },
      select: { registrationPath: true, campaignId: true, spend: true },
      take: 3,
    });
    if (metrics.length > 0) {
      console.log(`  Metric registrationPath: ${metrics[0].registrationPath}`);
      const totalSpend = metrics.reduce((s, m) => s + m.spend, 0);
      console.log(`  Metric spend: ¥${Math.round(totalSpend).toLocaleString()}`);
    }
  }

  await prisma.$disconnect();
}
main().catch(console.error);
