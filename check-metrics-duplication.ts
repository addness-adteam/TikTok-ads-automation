// AI導線のメトリクス重複を確認するスクリプト
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkMetricsDuplication() {
  console.log('AI導線の広告メトリクスの重複を確認します...\n');

  // AI導線の広告を取得（広告名に"AI"を含むもの）
  const aiAds = await prisma.ad.findMany({
    where: {
      name: {
        contains: 'AI',
      },
    },
    include: {
      metrics: {
        orderBy: {
          statDate: 'desc',
        },
        take: 20, // 最新20件
      },
    },
  });

  console.log(`AI導線の広告数: ${aiAds.length}\n`);

  // メトリクスがある広告のみをフィルタ
  const adsWithMetrics = aiAds.filter((ad) => ad.metrics.length > 0);
  console.log(`メトリクスがある広告数: ${adsWithMetrics.length}\n`);

  if (adsWithMetrics.length === 0) {
    console.log('⚠️ AI導線の広告にメトリクスデータが全く保存されていません！');
    console.log('これが支出データのずれの原因です。\n');

    // SNS導線の広告も確認
    console.log('比較のためSNS導線の広告を確認します...\n');
    const snsAds = await prisma.ad.findMany({
      where: {
        name: {
          contains: 'SNS',
        },
      },
      include: {
        metrics: {
          orderBy: {
            statDate: 'desc',
          },
          take: 5,
        },
      },
    });

    const snsAdsWithMetrics = snsAds.filter((ad) => ad.metrics.length > 0);
    console.log(`SNS導線の広告数: ${snsAds.length}`);
    console.log(`メトリクスがある広告数: ${snsAdsWithMetrics.length}\n`);

    if (snsAdsWithMetrics.length > 0) {
      const sampleAd = snsAdsWithMetrics[0];
      console.log(`サンプル広告（SNS）: ${sampleAd.name}`);
      console.log(`メトリクス数: ${sampleAd.metrics.length}`);
      console.log('最近のメトリクス:');
      sampleAd.metrics.slice(0, 5).forEach((m) => {
        console.log(
          `  ${m.statDate.toISOString().split('T')[0]} - ` +
            `支出: ¥${m.spend}, インプレッション: ${m.impressions}`,
        );
      });
    }
  } else {
    for (const ad of adsWithMetrics.slice(0, 3)) {
      // メトリクスがある広告の最初の3つのみ表示
    console.log(`\n広告: ${ad.name}`);
    console.log(`TikTok ID: ${ad.tiktokId}`);
    console.log(`メトリクス数: ${ad.metrics.length}`);
    console.log('\n最近のメトリクス:');

    for (const metric of ad.metrics) {
      console.log(
        `  ${metric.statDate.toISOString().split('T')[0]} - ` +
          `支出: ¥${metric.spend}, ` +
          `インプレッション: ${metric.impressions}, ` +
          `クリック: ${metric.clicks}`,
      );
    }

    // 同じ日付のメトリクスが複数あるか確認
    const dateGroups = ad.metrics.reduce(
      (acc, m) => {
        const dateStr = m.statDate.toISOString().split('T')[0];
        acc[dateStr] = (acc[dateStr] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const duplicates = Object.entries(dateGroups).filter(([_, count]) => count > 1);
    if (duplicates.length > 0) {
      console.log('\n⚠️ 重複している日付:');
      duplicates.forEach(([date, count]) => {
        console.log(`  ${date}: ${count}件`);
      });
    }
    }
  }

  // 全体の統計
  console.log('\n\n=== 全体統計 ===');

  // 過去7日間の期間を計算（予算調整と同じロジック）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() - 1);
  endDate.setHours(23, 59, 59, 999);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);
  startDate.setHours(0, 0, 0, 0);

  console.log(`\n予算調整の評価期間: ${startDate.toISOString()} ～ ${endDate.toISOString()}`);
  console.log(`日付のみ: ${startDate.toISOString().split('T')[0]} ～ ${endDate.toISOString().split('T')[0]}`);

  // scheduler.service.tsと同じ日付計算
  const schedulerEndDate = new Date();
  schedulerEndDate.setDate(schedulerEndDate.getDate() - 1);
  const schedulerStartDate = new Date();
  schedulerStartDate.setDate(schedulerStartDate.getDate() - 7);

  const schedulerStartDateStr = schedulerStartDate.toISOString().split('T')[0];
  const schedulerEndDateStr = schedulerEndDate.toISOString().split('T')[0];

  console.log(`\nメトリクス取得の期間（scheduler.service.ts）:`);
  console.log(`  ${schedulerStartDateStr} ～ ${schedulerEndDateStr}`);
  console.log(`  ※ タイムゾーンの問題により1日ずれる可能性があります`);

  await prisma.$disconnect();
}

checkMetricsDuplication().catch((error) => {
  console.error(error);
  process.exit(1);
});
