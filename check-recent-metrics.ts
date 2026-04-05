// 最近のメトリクス取得状況を確認するスクリプト
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkRecentMetrics() {
  console.log('=== メトリクス取得状況の確認 ===\n');

  // 全メトリクスの最新日付を確認
  const latestMetric = await prisma.metric.findFirst({
    orderBy: {
      statDate: 'desc',
    },
  });

  console.log('データベース全体の最新メトリクス日付:');
  if (latestMetric) {
    console.log(`  ${latestMetric.statDate.toISOString()}`);
    console.log(`  日付のみ: ${latestMetric.statDate.toISOString().split('T')[0]}\n`);
  } else {
    console.log('  メトリクスが全く保存されていません！\n');
  }

  // AI導線の最新メトリクス
  const aiAds = await prisma.ad.findMany({
    where: {
      name: {
        contains: 'AI',
      },
    },
    select: {
      id: true,
    },
  });

  const latestAiMetric = await prisma.metric.findFirst({
    where: {
      adId: {
        in: aiAds.map((ad) => ad.id),
      },
    },
    orderBy: {
      statDate: 'desc',
    },
  });

  console.log('AI導線の最新メトリクス日付:');
  if (latestAiMetric) {
    console.log(`  ${latestAiMetric.statDate.toISOString()}`);
    console.log(`  日付のみ: ${latestAiMetric.statDate.toISOString().split('T')[0]}\n`);
  } else {
    console.log('  AI導線のメトリクスが全く保存されていません！\n');
  }

  // SNS導線の最新メトリクス
  const snsAds = await prisma.ad.findMany({
    where: {
      name: {
        contains: 'SNS',
      },
    },
    select: {
      id: true,
    },
  });

  const latestSnsMetric = await prisma.metric.findFirst({
    where: {
      adId: {
        in: snsAds.map((ad) => ad.id),
      },
    },
    orderBy: {
      statDate: 'desc',
    },
  });

  console.log('SNS導線の最新メトリクス日付:');
  if (latestSnsMetric) {
    console.log(`  ${latestSnsMetric.statDate.toISOString()}`);
    console.log(`  日付のみ: ${latestSnsMetric.statDate.toISOString().split('T')[0]}\n`);
  } else {
    console.log('  SNS導線のメトリクスが全く保存されていません！\n');
  }

  // 日別のメトリクス数を確認（過去10日間）
  console.log('=== 過去10日間のメトリクス保存状況 ===\n');

  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

  const recentMetrics = await prisma.metric.findMany({
    where: {
      statDate: {
        gte: tenDaysAgo,
      },
    },
    orderBy: {
      statDate: 'desc',
    },
  });

  // 日付ごとにグループ化
  const metricsByDate = recentMetrics.reduce(
    (acc, m) => {
      const dateStr = m.statDate.toISOString().split('T')[0];
      if (!acc[dateStr]) {
        acc[dateStr] = { count: 0, totalSpend: 0, totalImpressions: 0 };
      }
      acc[dateStr].count++;
      acc[dateStr].totalSpend += m.spend;
      acc[dateStr].totalImpressions += m.impressions;
      return acc;
    },
    {} as Record<string, { count: number; totalSpend: number; totalImpressions: number }>,
  );

  // 日付順にソート
  const sortedDates = Object.keys(metricsByDate).sort().reverse();

  console.log('日付 | メトリクス数 | 合計支出 | 合計インプレッション');
  console.log('------|-------------|---------|-------------------');
  sortedDates.forEach((date) => {
    const data = metricsByDate[date];
    console.log(
      `${date} | ${data.count.toString().padStart(11)} | ¥${data.totalSpend.toFixed(0).padStart(6)} | ${data.totalImpressions.toString().padStart(17)}`,
    );
  });

  if (sortedDates.length === 0) {
    console.log('過去10日間のメトリクスが全く保存されていません！');
  }

  // メトリクスの作成日時を確認（最近保存されたメトリクス）
  console.log('\n=== 最近保存されたメトリクス（createdAt基準） ===\n');

  const recentlyCreatedMetrics = await prisma.metric.findMany({
    orderBy: {
      createdAt: 'desc',
    },
    take: 5,
    include: {
      ad: {
        select: {
          name: true,
        },
      },
    },
  });

  recentlyCreatedMetrics.forEach((m) => {
    console.log(`保存日時: ${m.createdAt.toISOString()}`);
    console.log(`  statDate: ${m.statDate.toISOString().split('T')[0]}`);
    console.log(`  広告: ${m.ad?.name || 'N/A'}`);
    console.log(`  支出: ¥${m.spend}, インプレッション: ${m.impressions}\n`);
  });

  await prisma.$disconnect();
}

checkRecentMetrics().catch((error) => {
  console.error(error);
  process.exit(1);
});
