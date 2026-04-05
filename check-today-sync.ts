import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 今日（12/5 JST）に同期された広告を確認
  // 12/5 00:00 JST = 12/4 15:00 UTC
  const todayStart = new Date('2025-12-04T15:00:00Z');
  const todayEnd = new Date('2025-12-05T15:00:00Z');

  console.log('=== 今日（12/5 JST）に作成/更新された広告 ===\n');
  console.log(`検索範囲: ${todayStart.toISOString()} - ${todayEnd.toISOString()}`);

  // 今日作成された広告
  const todayCreatedAds = await prisma.ad.findMany({
    where: {
      createdAt: {
        gte: todayStart,
        lt: todayEnd
      }
    },
    orderBy: { createdAt: 'desc' },
    select: {
      tiktokId: true,
      name: true,
      createdAt: true,
      adGroup: {
        select: {
          campaign: {
            select: {
              advertiser: {
                select: { name: true, tiktokAdvertiserId: true }
              }
            }
          }
        }
      }
    }
  });

  console.log(`\n今日作成された広告: ${todayCreatedAds.length}件`);
  todayCreatedAds.forEach(ad => {
    const createdJST = new Date(ad.createdAt.getTime() + 9 * 60 * 60 * 1000);
    const isProperName = ad.name.match(/^\d{6}\//);
    console.log(`${createdJST.toISOString().substring(0, 19)} - ${isProperName ? '✅' : '❌'} ${ad.name.substring(0, 60)}`);
    console.log(`  tiktokId: ${ad.tiktokId}`);
    console.log(`  Account: ${ad.adGroup.campaign.advertiser.name}`);
  });

  // 今日更新された広告（作成日は今日以前）
  const todayUpdatedAds = await prisma.ad.findMany({
    where: {
      updatedAt: {
        gte: todayStart,
        lt: todayEnd
      },
      createdAt: {
        lt: todayStart
      }
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: {
      tiktokId: true,
      name: true,
      createdAt: true,
      updatedAt: true
    }
  });

  console.log(`\n今日更新された広告（作成は以前）: ${todayUpdatedAds.length}件`);
  todayUpdatedAds.slice(0, 10).forEach(ad => {
    const isProperName = ad.name.match(/^\d{6}\//);
    console.log(`${isProperName ? '✅' : '❌'} ${ad.name.substring(0, 60)} (tiktokId: ${ad.tiktokId})`);
  });

  // AI_1アカウントの最近の広告を確認
  console.log(`\n=== AI_1アカウントの最近の広告状態 ===\n`);

  const ai1RecentAds = await prisma.ad.findMany({
    where: {
      adGroup: {
        campaign: {
          advertiser: { tiktokAdvertiserId: '7468288053866561553' }
        }
      }
    },
    orderBy: { updatedAt: 'desc' },
    take: 15,
    select: {
      tiktokId: true,
      name: true,
      createdAt: true,
      updatedAt: true
    }
  });

  let properNameCount = 0;
  let improperNameCount = 0;

  ai1RecentAds.forEach(ad => {
    const isProperName = ad.name.match(/^\d{6}\//);
    if (isProperName) {
      properNameCount++;
    } else {
      improperNameCount++;
    }
    const updatedJST = new Date(ad.updatedAt.getTime() + 9 * 60 * 60 * 1000);
    console.log(`${updatedJST.toISOString().substring(0, 19)} - ${isProperName ? '✅' : '❌'} ${ad.name.substring(0, 50)}`);
  });

  console.log(`\n正しい形式: ${properNameCount}件, クリエイティブ名形式: ${improperNameCount}件`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
