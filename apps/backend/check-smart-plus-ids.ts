import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  // DBの広告IDを確認
  const ads = await prisma.ad.findMany({
    where: {
      name: { startsWith: '2512' },
      adGroup: {
        campaign: {
          advertiser: {
            tiktokAdvertiserId: '7468288053866561553'
          }
        }
      }
    },
    select: {
      tiktokId: true,
      name: true
    },
    take: 10
  });

  console.log('DBの広告ID（2512で始まる）:');
  for (const ad of ads) {
    console.log('  ID:', ad.tiktokId, '|', ad.name.substring(0, 50));
  }

  // Smart+ APIが返すID: 1854389388802146
  // これがDBのtiktokIdと一致するか確認
  const testIds = ['1854389388802146', '1854392107768850', '1854389388793250'];

  console.log('\nSmart+ IDの検索結果:');
  for (const id of testIds) {
    const matchedAd = await prisma.ad.findFirst({
      where: { tiktokId: id },
      select: { tiktokId: true, name: true }
    });

    if (matchedAd) {
      console.log(`  ${id}: 見つかりました - ${matchedAd.name.substring(0, 40)}`);
    } else {
      console.log(`  ${id}: 見つかりませんでした`);
    }
  }

  await prisma.$disconnect();
}

main();
