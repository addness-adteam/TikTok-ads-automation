import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

async function check() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  // AI1のAdvertiserを取得
  const advertiser = await prisma.advertiser.findFirst({
    where: { tiktokAdvertiserId: '7468288053866561553' }
  });

  if (!advertiser) {
    console.log('AI1が見つかりません');
    await app.close();
    return;
  }

  // AI1の広告数を確認
  const adCount = await prisma.ad.count({
    where: {
      adGroup: {
        campaign: {
          advertiserId: advertiser.id
        }
      }
    }
  });

  console.log('AI1のDB内の広告数:', adCount);

  // 最新20件の広告を確認
  const latestAds = await prisma.ad.findMany({
    where: {
      adGroup: {
        campaign: {
          advertiserId: advertiser.id
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      tiktokId: true,
      name: true,
      createdAt: true,
      adGroup: {
        select: {
          bidType: true
        }
      }
    }
  });

  console.log('\n最新20件の広告:');
  latestAds.forEach((ad, i) => {
    const isSmartPlus = ad.adGroup.bidType === 'BID_TYPE_NO_BID' ? '[S+]' : '';
    console.log(`[${i+1}] ${ad.tiktokId} ${isSmartPlus}`);
    console.log(`    ${ad.name}`);
    console.log(`    作成: ${ad.createdAt.toISOString()}`);
  });

  // 問題の広告名で検索
  console.log('\n\n問題の広告名でDB検索:');
  const targetNames = [
    '251128/清水絢吾/箕輪',
    '251128/清水絢吾/ピザ',
    '251201/高橋海斗/配達員'
  ];

  for (const name of targetNames) {
    const found = await prisma.ad.findFirst({
      where: {
        name: { contains: name }
      }
    });
    console.log(`  "${name}": ${found ? '見つかりました - ' + found.tiktokId : '見つかりませんでした'}`);
  }

  await app.close();
}
check();
