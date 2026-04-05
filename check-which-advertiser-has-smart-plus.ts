import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkWhichAdvertiserHasSmartPlus() {
  console.log('=== Smart+広告がどのAdvertiserにあるか確認 ===\n');

  // すべてのAdvertiserを取得
  const advertisers = await prisma.advertiser.findMany({
    select: {
      id: true,
      name: true,
      tiktokAdvertiserId: true,
    },
  });

  console.log(`データベース内のAdvertiser数: ${advertisers.length}\n`);

  for (const advertiser of advertisers) {
    // このAdvertiserの全広告を取得
    const allAds = await prisma.ad.findMany({
      where: {
        adGroup: {
          campaign: {
            advertiserId: advertiser.id,
          },
        },
      },
    });

    // Smart+ Ad IDの形式を判定（長い数値IDは smart_plus_ad_id の可能性が高い）
    const potentialSmartPlusAds = allAds.filter((ad) => {
      // smart_plus_ad_id は通常 16桁以上の数値
      return ad.tiktokId.length >= 16 && /^\d+$/.test(ad.tiktokId);
    });

    // 手動広告名を持つ広告（新スマプラの特徴）
    const smartPlusAds = potentialSmartPlusAds.filter((ad) => {
      return ad.name && ad.name.includes('/') && !ad.name.includes('.mp4') && !ad.name.includes('.MP4');
    });

    // メトリクスがある広告を確認
    const adsWithMetrics = await prisma.ad.count({
      where: {
        id: {
          in: smartPlusAds.map(ad => ad.id),
        },
        metrics: {
          some: {},
        },
      },
    });

    if (smartPlusAds.length > 0) {
      console.log(`📊 ${advertiser.name} (${advertiser.tiktokAdvertiserId})`);
      console.log(`   全広告数: ${allAds.length}`);
      console.log(`   Smart+広告数: ${smartPlusAds.length}`);
      console.log(`   メトリクスがある広告数: ${adsWithMetrics}`);
      console.log('');
    } else {
      console.log(`⚪ ${advertiser.name} (${advertiser.tiktokAdvertiserId}): Smart+広告なし`);
    }
  }

  // 最近更新されたSmart+広告を表示
  console.log('\n=== 最近更新されたSmart+広告（全Advertiser） ===\n');

  const recentSmartPlusAds = await prisma.ad.findMany({
    where: {
      AND: [
        { tiktokId: { not: { contains: '.mp4' } } },
        { tiktokId: { not: { contains: '.MP4' } } },
        { name: { contains: '/' } },
      ],
    },
    include: {
      adGroup: {
        include: {
          campaign: {
            include: {
              advertiser: true,
            },
          },
        },
      },
      metrics: {
        orderBy: { statDate: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 5,
  });

  recentSmartPlusAds.forEach((ad, index) => {
    console.log(`[${index + 1}] ${ad.name}`);
    console.log(`    TikTok ID: ${ad.tiktokId}`);
    console.log(`    Advertiser: ${ad.adGroup.campaign.advertiser?.name || 'N/A'}`);
    console.log(`    Campaign: ${ad.adGroup.campaign.name}`);
    console.log(`    更新日時: ${ad.updatedAt.toISOString()}`);
    if (ad.metrics.length > 0) {
      const metric = ad.metrics[0];
      console.log(`    最新メトリクス (${metric.statDate.toISOString().split('T')[0]}): 支出=¥${metric.spend}, CV=${metric.conversions}`);
    } else {
      console.log(`    メトリクス: なし`);
    }
    console.log('');
  });

  await prisma.$disconnect();
}

checkWhichAdvertiserHasSmartPlus().catch((error) => {
  console.error(error);
  process.exit(1);
});
