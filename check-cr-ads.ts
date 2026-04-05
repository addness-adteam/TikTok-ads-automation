import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // まず、全広告主を確認
  const advertisers = await prisma.advertiser.findMany({
    select: {
      id: true,
      name: true,
      tiktokAdvertiserId: true
    }
  });
  console.log('All advertisers:', advertisers);

  // Search for ads with names containing CR00680 or CR00679
  const ads = await prisma.ad.findMany({
    where: {
      OR: [
        { name: { contains: 'CR00680' } },
        { name: { contains: 'CR00679' } }
      ]
    },
    include: {
      adGroup: {
        include: {
          campaign: true
        }
      }
    }
  });

  console.log('\nFound ads with CR00680/CR00679:', JSON.stringify(ads, null, 2));
  console.log('Total ads found:', ads.length);

  // Search by partial name - 高橋海斗
  const adsByTakahashi = await prisma.ad.findMany({
    where: {
      name: { contains: '高橋海斗' }
    },
    include: {
      adGroup: {
        include: {
          campaign: true
        }
      }
    }
  });
  console.log('\nAds with 高橋海斗:', adsByTakahashi.length);
  if (adsByTakahashi.length > 0) {
    console.log('Found:', adsByTakahashi.map(a => ({ id: a.id, name: a.name, tiktokId: a.tiktokId })));
  }

  // Search by 251204
  const adsByDate = await prisma.ad.findMany({
    where: {
      name: { contains: '251204' }
    },
    include: {
      adGroup: {
        include: {
          campaign: true
        }
      }
    }
  });
  console.log('\nAds with 251204:', adsByDate.length);
  if (adsByDate.length > 0) {
    console.log('Found:', adsByDate.map(a => ({ id: a.id, name: a.name, tiktokId: a.tiktokId })));
  }

  // インタビュー
  const adsByInterview = await prisma.ad.findMany({
    where: {
      name: { contains: 'インタビュー' }
    },
    include: {
      adGroup: {
        include: {
          campaign: true
        }
      }
    }
  });
  console.log('\nAds with インタビュー:', adsByInterview.length);
  if (adsByInterview.length > 0 && adsByInterview.length < 20) {
    console.log('Found:', adsByInterview.map(a => ({ id: a.id, name: a.name, tiktokId: a.tiktokId })));
  }

  // Also check metrics for these ads if found
  if (ads.length > 0) {
    const adIds = ads.map(a => a.id);
    const metrics = await prisma.metric.findMany({
      where: {
        adId: { in: adIds }
      },
      orderBy: { statDate: 'desc' },
      take: 20
    });
    console.log('\nMetrics for these ads:', JSON.stringify(metrics, null, 2));
    console.log('Total metrics found:', metrics.length);

    // Also check AdPerformance
    const performances = await prisma.adPerformance.findMany({
      where: {
        adId: { in: adIds }
      }
    });
    console.log('\nAdPerformance for these ads:', JSON.stringify(performances, null, 2));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
