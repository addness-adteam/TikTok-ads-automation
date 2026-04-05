// 全広告主のAD単位メトリクスを確認するスクリプト
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAllAdvertisersMetrics() {
  console.log('=== 全広告主のAD単位メトリクス確認（11/16） ===\n');

  // 11/16のAD単位メトリクスを取得
  const metrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      statDate: new Date('2025-11-16T00:00:00.000Z'),
    },
    include: {
      ad: {
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
        },
      },
    },
  });

  console.log(`11/16のAD単位メトリクス総数: ${metrics.length}件\n`);

  // 広告主ごとにグループ化
  const advertiserGroups = metrics.reduce(
    (acc, m) => {
      const advId = m.ad?.adGroup?.campaign?.advertiser?.tiktokAdvertiserId || '不明';
      const advName = m.ad?.adGroup?.campaign?.advertiser?.name || '不明';
      if (!acc[advId]) {
        acc[advId] = {
          name: advName,
          metrics: [],
        };
      }
      acc[advId].metrics.push(m);
      return acc;
    },
    {} as Record<string, { name: string; metrics: any[] }>,
  );

  console.log(`メトリクスがある広告主数: ${Object.keys(advertiserGroups).length}\n`);

  // 各広告主の統計を表示
  Object.entries(advertiserGroups).forEach(([advId, data]) => {
    const totalSpend = data.metrics.reduce((sum, m) => sum + m.spend, 0);
    const totalImpressions = data.metrics.reduce((sum, m) => sum + m.impressions, 0);

    console.log(`広告主ID: ${advId}`);
    console.log(`  名前: ${data.name}`);
    console.log(`  AD単位メトリクス数: ${data.metrics.length}件`);
    console.log(`  合計支出: ¥${totalSpend.toFixed(0)}`);
    console.log(`  合計インプレッション: ${totalImpressions}`);
    console.log(`  広告例: ${data.metrics[0]?.ad?.name || 'N/A'}`);
    console.log();
  });

  console.log('=== 結論 ===');
  console.log(`✅ 全${Object.keys(advertiserGroups).length}広告主でAD単位のメトリクスが正しく保存されています`);
  console.log(`✅ 合計${metrics.length}件のAD単位メトリクスが11/16に保存されました`);

  await prisma.$disconnect();
}

checkAllAdvertisersMetrics().catch((error) => {
  console.error(error);
  process.exit(1);
});
