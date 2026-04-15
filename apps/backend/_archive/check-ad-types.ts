import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  const crNames = ['CR01190', 'CR01144', 'CR01169', 'CR01163'];

  for (const cr of crNames) {
    const ads = await prisma.ad.findMany({
      where: {
        name: { contains: cr },
        adGroup: {
          campaign: {
            advertiser: { tiktokAdvertiserId: '7468288053866561553' }
          }
        }
      },
      include: {
        adGroup: {
          include: { campaign: true }
        }
      }
    });

    console.log(`\n=== ${cr}: ${ads.length}件 ===`);
    for (const ad of ads) {
      console.log(`  ad: ${ad.tiktokId} | ${ad.name}`);
      console.log(`  status: ${ad.status}`);
      console.log(`  adGroup: ${ad.adGroup.tiktokId} | budgetMode: ${ad.adGroup.budgetMode} | budget: ${ad.adGroup.budget}`);
      console.log(`  campaign: ${ad.adGroup.campaign.tiktokId} | budgetMode: ${ad.adGroup.campaign.budgetMode} | CBO: ${ad.adGroup.campaign.budgetOptimizeOn}`);
      console.log(`  initialBudget: ${ad.adGroup.initialBudget}`);
    }
  }

  // CR01190のadgroup 1861895774239058 のChangeLog全件
  console.log(`\n=== CR01190 adgroup ChangeLog ===`);
  const cl1190 = await prisma.changeLog.findMany({
    where: {
      entityId: '1861895774239058',
      createdAt: {
        gte: new Date('2026-04-08T15:00:00Z'),
        lt: new Date('2026-04-09T15:00:00Z'),
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  for (const cl of cl1190) {
    const jst = new Date(cl.createdAt.getTime() + 9 * 60 * 60 * 1000);
    const bd = cl.beforeData as any;
    const ad = cl.afterData as any;
    console.log(`  ${jst.toISOString().slice(11, 16)} | ${cl.action} | ${cl.source} | ${bd?.budget}→${ad?.budget}`);
  }

  // CR01144のadgroup ChangeLog
  const ads1144 = await prisma.ad.findFirst({
    where: {
      name: { contains: 'CR01144' },
      adGroup: {
        campaign: {
          advertiser: { tiktokAdvertiserId: '7468288053866561553' }
        }
      }
    },
    include: { adGroup: true }
  });

  if (ads1144) {
    console.log(`\n=== CR01144 adgroup ${ads1144.adGroup.tiktokId} ChangeLog ===`);
    const cl1144 = await prisma.changeLog.findMany({
      where: {
        entityId: ads1144.adGroup.tiktokId,
        createdAt: {
          gte: new Date('2026-04-08T15:00:00Z'),
          lt: new Date('2026-04-09T15:00:00Z'),
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    for (const cl of cl1144) {
      const jst = new Date(cl.createdAt.getTime() + 9 * 60 * 60 * 1000);
      const bd = cl.beforeData as any;
      const ad = cl.afterData as any;
      console.log(`  ${jst.toISOString().slice(11, 16)} | ${cl.action} | ${cl.source} | ${bd?.budget}→${ad?.budget}`);
    }
    if (cl1144.length === 0) console.log('  (なし)');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
