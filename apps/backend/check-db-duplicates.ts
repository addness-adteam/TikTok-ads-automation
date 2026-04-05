import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  console.log('=== DBデータ確認 ===\n');

  // 同じadId + 同じ日付で複数レコードがあるかチェック
  const duplicates = await prisma.$queryRaw`
    SELECT "adId", "statDate", COUNT(*) as cnt
    FROM metrics
    WHERE "entityType" = 'AD'
      AND "statDate" >= '2025-12-01'
      AND "statDate" <= '2025-12-31'
    GROUP BY "adId", "statDate"
    HAVING COUNT(*) > 1
    LIMIT 10
  ` as any[];

  console.log('重複レコード確認:');
  if (duplicates.length === 0) {
    console.log('  重複なし（各広告・各日付で1レコードのみ）');
  } else {
    console.log('  重複あり:', duplicates);
  }

  // 特定の広告の12月データを確認
  const sampleAd = await prisma.metric.findFirst({
    where: {
      entityType: 'AD',
      statDate: { gte: new Date('2025-12-01') },
      spend: { gt: 0 },
    },
    include: {
      ad: true,
    },
  });

  if (sampleAd) {
    console.log('\n=== サンプル広告の12月データ ===');
    console.log('広告ID:', sampleAd.ad?.tiktokId);
    console.log('広告名:', sampleAd.ad?.name);

    const adMetrics = await prisma.metric.findMany({
      where: {
        adId: sampleAd.adId,
        statDate: {
          gte: new Date('2025-12-01'),
          lte: new Date('2025-12-31'),
        },
      },
      orderBy: { statDate: 'asc' },
    });

    console.log('\n日別データ:');
    for (const m of adMetrics) {
      const dateStr = m.statDate.toISOString().split('T')[0];
      console.log(`  ${dateStr}: spend=¥${m.spend.toLocaleString()}, imp=${m.impressions}, clicks=${m.clicks}`);
    }

    const totalSpend = adMetrics.reduce((sum, m) => sum + m.spend, 0);
    console.log('\nDBから合計した消費額:', `¥${totalSpend.toLocaleString()}`);
    console.log('レコード数:', adMetrics.length);
  }

  // 全体の確認
  console.log('\n=== 12月全体の統計 ===');

  const totalMetrics = await prisma.metric.aggregate({
    where: {
      entityType: 'AD',
      statDate: {
        gte: new Date('2025-12-01'),
        lte: new Date('2025-12-31'),
      },
    },
    _sum: {
      spend: true,
      impressions: true,
      clicks: true,
    },
    _count: true,
  });

  console.log('12月のADメトリクス総計:');
  console.log('  レコード数:', totalMetrics._count);
  console.log('  消費額合計:', `¥${totalMetrics._sum.spend?.toLocaleString()}`);
  console.log('  インプレッション合計:', totalMetrics._sum.impressions?.toLocaleString());
  console.log('  クリック合計:', totalMetrics._sum.clicks?.toLocaleString());

  await prisma.$disconnect();
}

check().catch(console.error);
