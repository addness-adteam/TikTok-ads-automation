// 特定の広告主のメトリクスを確認するスクリプト
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ADVERTISER_ID = '7504155142942474248';

async function checkAdvertiserMetrics() {
  console.log(`=== 広告主 ${ADVERTISER_ID} のメトリクス確認 ===\n`);

  // この広告主の広告を取得
  const ads = await prisma.ad.findMany({
    where: {
      adGroup: {
        campaign: {
          advertiserId: ADVERTISER_ID,
        },
      },
    },
    include: {
      metrics: {
        where: {
          entityType: 'AD',
        },
        orderBy: {
          statDate: 'desc',
        },
        take: 5,
      },
    },
  });

  console.log(`この広告主の広告数: ${ads.length}\n`);

  const adsWithMetrics = ads.filter((ad) => ad.metrics.length > 0);
  console.log(`AD単位のメトリクスがある広告数: ${adsWithMetrics.length}\n`);

  if (adsWithMetrics.length > 0) {
    console.log('サンプル広告:');
    const sampleAd = adsWithMetrics[0];
    console.log(`  広告名: ${sampleAd.name}`);
    console.log(`  最新のメトリクス:`);
    sampleAd.metrics.forEach((m) => {
      console.log(
        `    ${m.statDate.toISOString().split('T')[0]} - 支出: ¥${m.spend}, インプレッション: ${m.impressions}`,
      );
    });
  } else {
    console.log('⚠️ この広告主の広告にはAD単位のメトリクスが全くありません！');
  }

  // ADGROUP単位のメトリクスを確認
  const adgroups = await prisma.adGroup.findMany({
    where: {
      campaign: {
        advertiserId: ADVERTISER_ID,
      },
    },
    include: {
      metrics: {
        where: {
          entityType: 'ADGROUP',
        },
        orderBy: {
          statDate: 'desc',
        },
        take: 5,
      },
    },
  });

  console.log(`\nこの広告主の広告グループ数: ${adgroups.length}`);

  const adgroupsWithMetrics = adgroups.filter((ag) => ag.metrics.length > 0);
  console.log(`ADGROUP単位のメトリクスがある広告グループ数: ${adgroupsWithMetrics.length}\n`);

  if (adgroupsWithMetrics.length > 0) {
    console.log('サンプル広告グループ:');
    const sampleAg = adgroupsWithMetrics[0];
    console.log(`  広告グループ名: ${sampleAg.name}`);
    console.log(`  最新のメトリクス:`);
    sampleAg.metrics.forEach((m) => {
      console.log(
        `    ${m.statDate.toISOString().split('T')[0]} - 支出: ¥${m.spend}, インプレッション: ${m.impressions}`,
      );
    });
  }

  // 全広告主のリストを表示
  console.log('\n=== データベース内の全広告主 ===\n');

  const campaigns = await prisma.campaign.findMany({
    select: {
      advertiserId: true,
      id: true,
    },
    distinct: ['advertiserId'],
  });

  const advertiserIds = [...new Set(campaigns.map((c) => c.advertiserId))];

  console.log(`広告主の数: ${advertiserIds.length}\n`);

  for (const advId of advertiserIds.slice(0, 5)) {
    const adCount = await prisma.ad.count({
      where: {
        adGroup: {
          campaign: {
            advertiserId: advId,
          },
        },
        metrics: {
          some: {
            entityType: 'AD',
          },
        },
      },
    });

    console.log(`広告主 ${advId}: AD単位のメトリクスがある広告数 = ${adCount}`);
  }

  await prisma.$disconnect();
}

checkAdvertiserMetrics().catch((error) => {
  console.error(error);
  process.exit(1);
});
