/**
 * 生のメトリクスデータを確認（タイムゾーンに注意）
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkRawData() {
  try {
    const tiktokAdId = '1848545700919346';

    const ad = await prisma.ad.findUnique({
      where: { tiktokId: tiktokAdId },
    });

    if (!ad) {
      console.log('広告が見つかりません');
      return;
    }

    console.log(`広告: ${ad.name}`);
    console.log(`広告ID (DB): ${ad.id}\n`);

    // この広告の全メトリクスを取得（生データ）
    const metrics = await prisma.metric.findMany({
      where: { adId: ad.id },
      orderBy: { statDate: 'asc' },
    });

    console.log(`合計 ${metrics.length} 件のメトリクス\n`);

    console.log('生のメトリクスデータ:');
    console.log('='.repeat(150));

    for (const m of metrics) {
      console.log(`\nメトリクスID: ${m.id}`);
      console.log(`  statDate (UTC): ${m.statDate.toISOString()}`);
      console.log(`  statDate (JST): ${new Date(m.statDate.getTime() + 9 * 60 * 60 * 1000).toISOString()}`);
      console.log(`  createdAt: ${m.createdAt.toISOString()}`);
      console.log(`  entityType: ${m.entityType}`);
      console.log(`  Impressions: ${m.impressions}`);
      console.log(`  Clicks: ${m.clicks}`);
      console.log(`  Spend: ¥${m.spend.toFixed(2)}`);
      console.log(`  Conversions: ${m.conversions}`);
    }

    console.log('\n' + '='.repeat(150));

    // 同じAdGroup内の他の広告のメトリクスも確認
    const adGroup = await prisma.adGroup.findUnique({
      where: { id: ad.adgroupId },
      include: {
        ads: {
          select: {
            id: true,
            tiktokId: true,
            name: true,
            status: true,
          },
        },
      },
    });

    if (adGroup) {
      console.log(`\n同じAdGroup内の広告 (${adGroup.ads.length}件):`);
      console.log('─'.repeat(100));

      for (const otherAd of adGroup.ads) {
        const adMetricCount = await prisma.metric.count({
          where: { adId: otherAd.id },
        });

        const statusLabel = otherAd.status === 'ENABLE' ? '✓' : '✗';

        console.log(`${statusLabel} ${otherAd.tiktokId} | ${otherAd.name.substring(0, 60)} | メトリクス: ${adMetricCount}件`);
      }
    }

  } catch (error) {
    console.error('エラー:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkRawData();
