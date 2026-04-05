import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // CR00679/CR00680の正確なcreatedAt/updatedAtを確認
  // 修正後のtiktokIdで検索
  const ads = await prisma.ad.findMany({
    where: {
      tiktokId: {
        in: ['1850472306618481', '1850472803071026']
      }
    },
    select: {
      tiktokId: true,
      name: true,
      createdAt: true,
      updatedAt: true
    }
  });

  console.log('=== CR00679/CR00680 の正確なタイムスタンプ ===\n');

  ads.forEach(ad => {
    const createdJST = new Date(ad.createdAt.getTime() + 9 * 60 * 60 * 1000);
    const updatedJST = new Date(ad.updatedAt.getTime() + 9 * 60 * 60 * 1000);

    console.log(`tiktokId: ${ad.tiktokId}`);
    console.log(`name: ${ad.name}`);
    console.log(`createdAt (UTC): ${ad.createdAt.toISOString()}`);
    console.log(`createdAt (JST): ${createdJST.toISOString().replace('Z', ' JST')}`);
    console.log(`updatedAt (UTC): ${ad.updatedAt.toISOString()}`);
    console.log(`updatedAt (JST): ${updatedJST.toISOString().replace('Z', ' JST')}`);
    console.log('');
  });

  // 同期ジョブの実行タイミングを確認するため、他の広告のcreatedAtも確認
  console.log('=== 他の広告のcreatedAt（同期タイミング確認用） ===\n');

  const recentAds = await prisma.ad.findMany({
    where: {
      adGroup: {
        campaign: {
          advertiser: {
            tiktokAdvertiserId: '7468288053866561553'
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      tiktokId: true,
      name: true,
      createdAt: true
    }
  });

  recentAds.forEach(ad => {
    const createdJST = new Date(ad.createdAt.getTime() + 9 * 60 * 60 * 1000);
    console.log(`${createdJST.toISOString().replace('T', ' ').substring(0, 19)} JST - ${ad.name.substring(0, 50)}`);
  });

  // 12/3と12/4の同期で作成された広告の数を確認
  console.log('\n=== 同期日ごとの広告作成数 ===\n');

  const dec3Ads = await prisma.ad.count({
    where: {
      createdAt: {
        gte: new Date('2025-12-02T15:00:00Z'),  // 12/3 00:00 JST
        lt: new Date('2025-12-03T15:00:00Z')    // 12/4 00:00 JST
      },
      adGroup: {
        campaign: {
          advertiser: {
            tiktokAdvertiserId: '7468288053866561553'
          }
        }
      }
    }
  });

  const dec4Ads = await prisma.ad.count({
    where: {
      createdAt: {
        gte: new Date('2025-12-03T15:00:00Z'),  // 12/4 00:00 JST
        lt: new Date('2025-12-04T15:00:00Z')    // 12/5 00:00 JST
      },
      adGroup: {
        campaign: {
          advertiser: {
            tiktokAdvertiserId: '7468288053866561553'
          }
        }
      }
    }
  });

  console.log(`12/3 00:00 JST の同期で作成: ${dec3Ads}件`);
  console.log(`12/4 00:00 JST の同期で作成: ${dec4Ads}件`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
