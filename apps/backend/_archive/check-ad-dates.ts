import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  // AI導線のAdvertiser ID
  const AI_ADVERTISER_IDS = ['7468288053866561553', '7523128243466551303', '7543540647266074641'];

  // 広告を取得（AI導線のみ）
  const advertisers = await prisma.advertiser.findMany({
    where: {
      tiktokAdvertiserId: { in: AI_ADVERTISER_IDS }
    },
    include: {
      campaigns: {
        include: {
          adGroups: {
            include: {
              ads: {
                select: {
                  tiktokId: true,
                  name: true
                }
              }
            }
          }
        }
      }
    }
  });

  console.log('2509で始まる広告（2025年9月出稿）:');
  let count09 = 0;
  for (const adv of advertisers) {
    for (const camp of adv.campaigns) {
      for (const ag of camp.adGroups) {
        for (const ad of ag.ads) {
          if (ad.name.startsWith('2509')) {
            if (count09 < 5) {
              console.log('  -', ad.name);
              console.log('    ID:', ad.tiktokId);
            }
            count09++;
          }
        }
      }
    }
  }
  console.log('  合計:', count09);

  console.log('\n2512で始まる広告（2025年12月出稿）:');
  let count12 = 0;
  for (const adv of advertisers) {
    for (const camp of adv.campaigns) {
      for (const ag of camp.adGroups) {
        for (const ad of ag.ads) {
          if (ad.name.startsWith('2512')) {
            if (count12 < 5) {
              console.log('  -', ad.name);
              console.log('    ID:', ad.tiktokId);
            }
            count12++;
          }
        }
      }
    }
  }
  console.log('  合計:', count12);

  await prisma.$disconnect();
}

main();
