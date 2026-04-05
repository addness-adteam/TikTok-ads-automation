// メトリクスのentityTypeと紐付け状況を確認するスクリプト
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkMetricsEntityTypes() {
  console.log('=== メトリクスのentityTypeと紐付け状況の確認 ===\n');

  // 全メトリクスをentityTypeごとにカウント
  const metricsByEntityType = await prisma.metric.groupBy({
    by: ['entityType'],
    _count: {
      id: true,
    },
  });

  console.log('メトリクスのentityType別の件数:');
  metricsByEntityType.forEach((group) => {
    console.log(`  ${group.entityType}: ${group._count.id}件`);
  });
  console.log();

  // 最近保存されたメトリクスをentityType別に確認
  console.log('=== 最近保存されたメトリクス（entityType別） ===\n');

  const recentMetrics = await prisma.metric.findMany({
    orderBy: {
      createdAt: 'desc',
    },
    take: 20,
    include: {
      ad: {
        select: {
          name: true,
          tiktokId: true,
        },
      },
      adGroup: {
        select: {
          name: true,
          tiktokId: true,
        },
      },
      campaign: {
        select: {
          name: true,
          tiktokId: true,
        },
      },
    },
  });

  console.log('最近の20件のメトリクス:\n');

  const adCount = recentMetrics.filter((m) => m.entityType === 'AD').length;
  const adgroupCount = recentMetrics.filter((m) => m.entityType === 'ADGROUP').length;
  const campaignCount = recentMetrics.filter((m) => m.entityType === 'CAMPAIGN').length;

  console.log(`AD: ${adCount}件, ADGROUP: ${adgroupCount}件, CAMPAIGN: ${campaignCount}件\n`);

  recentMetrics.forEach((m, index) => {
    console.log(`${index + 1}. EntityType: ${m.entityType}`);
    console.log(`   StatDate: ${m.statDate.toISOString().split('T')[0]}`);
    console.log(`   支出: ¥${m.spend}, インプレッション: ${m.impressions}`);

    if (m.entityType === 'AD') {
      console.log(`   広告: ${m.ad?.name || '❌ 紐付けなし (adId: ' + m.adId + ')'}`);
      if (m.ad) {
        console.log(`   TikTok ID: ${m.ad.tiktokId}`);
      }
    } else if (m.entityType === 'ADGROUP') {
      console.log(`   広告グループ: ${m.adGroup?.name || '❌ 紐付けなし (adgroupId: ' + m.adgroupId + ')'}`);
      if (m.adGroup) {
        console.log(`   TikTok ID: ${m.adGroup.tiktokId}`);
      }
    } else if (m.entityType === 'CAMPAIGN') {
      console.log(`   キャンペーン: ${m.campaign?.name || '❌ 紐付けなし (campaignId: ' + m.campaignId + ')'}`);
      if (m.campaign) {
        console.log(`   TikTok ID: ${m.campaign.tiktokId}`);
      }
    }
    console.log();
  });

  // 紐付けに失敗しているメトリクスを確認
  console.log('=== 紐付けに失敗しているメトリクス ===\n');

  const orphanedAdMetrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      ad: null,
    },
    take: 10,
  });

  const orphanedAdgroupMetrics = await prisma.metric.findMany({
    where: {
      entityType: 'ADGROUP',
      adGroup: null,
    },
    take: 10,
  });

  const orphanedCampaignMetrics = await prisma.metric.findMany({
    where: {
      entityType: 'CAMPAIGN',
      campaign: null,
    },
    take: 10,
  });

  console.log(`広告と紐付けられていないADメトリクス: ${orphanedAdMetrics.length}件`);
  if (orphanedAdMetrics.length > 0) {
    console.log('サンプル:');
    orphanedAdMetrics.slice(0, 3).forEach((m) => {
      console.log(`  adId: ${m.adId}, statDate: ${m.statDate.toISOString().split('T')[0]}, spend: ¥${m.spend}`);
    });
  }
  console.log();

  console.log(`広告グループと紐付けられていないADGROUPメトリクス: ${orphanedAdgroupMetrics.length}件`);
  if (orphanedAdgroupMetrics.length > 0) {
    console.log('サンプル:');
    orphanedAdgroupMetrics.slice(0, 3).forEach((m) => {
      console.log(
        `  adgroupId: ${m.adgroupId}, statDate: ${m.statDate.toISOString().split('T')[0]}, spend: ¥${m.spend}`,
      );
    });
  }
  console.log();

  console.log(`キャンペーンと紐付けられていないCAMPAIGNメトリクス: ${orphanedCampaignMetrics.length}件`);
  if (orphanedCampaignMetrics.length > 0) {
    console.log('サンプル:');
    orphanedCampaignMetrics.slice(0, 3).forEach((m) => {
      console.log(
        `  campaignId: ${m.campaignId}, statDate: ${m.statDate.toISOString().split('T')[0]}, spend: ¥${m.spend}`,
      );
    });
  }
  console.log();

  // 予算調整で使用されるAD単位のメトリクスの状況を確認
  console.log('=== 予算調整で使用されるAD単位のメトリクス ===\n');

  // 評価期間を計算
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() - 1);
  endDate.setHours(23, 59, 59, 999);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);
  startDate.setHours(0, 0, 0, 0);

  console.log(`評価期間: ${startDate.toISOString().split('T')[0]} ～ ${endDate.toISOString().split('T')[0]}\n`);

  // AI導線の広告でメトリクスがあるものとないものをカウント
  const aiAds = await prisma.ad.findMany({
    where: {
      name: {
        contains: 'AI',
      },
    },
    include: {
      metrics: {
        where: {
          entityType: 'AD',
          statDate: {
            gte: startDate,
            lte: endDate,
          },
        },
      },
    },
  });

  const aiAdsWithMetrics = aiAds.filter((ad) => ad.metrics.length > 0);
  const aiAdsWithoutMetrics = aiAds.filter((ad) => ad.metrics.length === 0);

  console.log('AI導線の広告:');
  console.log(`  総数: ${aiAds.length}件`);
  console.log(`  評価期間内にADメトリクスあり: ${aiAdsWithMetrics.length}件`);
  console.log(`  評価期間内にADメトリクスなし: ${aiAdsWithoutMetrics.length}件\n`);

  // SNS導線も同様に確認
  const snsAds = await prisma.ad.findMany({
    where: {
      name: {
        contains: 'SNS',
      },
    },
    include: {
      metrics: {
        where: {
          entityType: 'AD',
          statDate: {
            gte: startDate,
            lte: endDate,
          },
        },
      },
    },
  });

  const snsAdsWithMetrics = snsAds.filter((ad) => ad.metrics.length > 0);
  const snsAdsWithoutMetrics = snsAds.filter((ad) => ad.metrics.length === 0);

  console.log('SNS導線の広告:');
  console.log(`  総数: ${snsAds.length}件`);
  console.log(`  評価期間内にADメトリクスあり: ${snsAdsWithMetrics.length}件`);
  console.log(`  評価期間内にADメトリクスなし: ${snsAdsWithoutMetrics.length}件\n`);

  // 問題の要約
  console.log('=== 問題の要約 ===\n');

  console.log('予算調整は AD 単位のメトリクスのみを使用します。');
  console.log('しかし、データベースには以下の3種類のメトリクスが保存されています:');
  metricsByEntityType.forEach((group) => {
    console.log(`  - ${group.entityType}: ${group._count.id}件`);
  });
  console.log();

  console.log('もし以下の問題があれば、予算調整の支出データがずれる原因になります:');
  console.log('  1. AD単位のメトリクスが保存されていない');
  console.log('  2. 広告との紐付けに失敗している');
  console.log('  3. 評価期間内のメトリクスがない（広告が停止中など）');

  await prisma.$disconnect();
}

checkMetricsEntityTypes().catch((error) => {
  console.error(error);
  process.exit(1);
});
