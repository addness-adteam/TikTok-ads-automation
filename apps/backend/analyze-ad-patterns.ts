import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  // AI導線のAdvertiser ID
  const AI_ADVERTISER_IDS = ['7468288053866561553', '7523128243466551303', '7543540647266074641'];

  // 広告名のパターンを分析
  const ads = await prisma.ad.findMany({
    where: {
      adGroup: {
        campaign: {
          advertiser: {
            tiktokAdvertiserId: { in: AI_ADVERTISER_IDS }
          }
        }
      }
    },
    select: {
      name: true
    }
  });

  // LP名を含む広告をカウント
  let lpPattern = 0;
  let noLpPattern = 0;
  let sept2025Plus = 0;

  const patterns = new Map<string, number>();
  const noLpExamples: string[] = [];

  for (const ad of ads) {
    const name = ad.name;

    // 2509以降かチェック
    const match = name.match(/^(\d{6})\//);
    if (match && match[1] >= '250901') {
      sept2025Plus++;

      // LP名のパターンを確認
      if (name.match(/LP\d+-CR\d+/i)) {
        lpPattern++;
      } else {
        noLpPattern++;
        // 例を記録
        if (noLpExamples.length < 10) {
          noLpExamples.push(name);
        }
      }
    }
  }

  console.log('2025年9月以降の広告:');
  console.log('  合計:', sept2025Plus);
  console.log('  LP名-CR番号パターン:', lpPattern);
  console.log('  その他パターン:', noLpPattern);

  console.log('\nその他パターンの例:');
  for (const ex of noLpExamples) {
    console.log('  -', ex);
  }

  await prisma.$disconnect();
}

main();
