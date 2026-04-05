/**
 * AI1のSmart+広告の不正確なメトリクスを削除
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteMetrics() {
  try {
    const tiktokAdId = '1848545700919346';

    console.log('========================================');
    console.log('AI1 Smart+広告のメトリクス削除');
    console.log('========================================\n');

    // 広告を検索
    const ad = await prisma.ad.findUnique({
      where: { tiktokId: tiktokAdId },
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
    });

    if (!ad) {
      console.log(`❌ 広告が見つかりません: ${tiktokAdId}`);
      return;
    }

    console.log(`✓ 広告を発見:`);
    console.log(`  - 広告名: ${ad.name}`);
    console.log(`  - Advertiser: ${ad.adGroup.campaign.advertiser.name}`);
    console.log(`  - BidType: ${ad.adGroup.bidType}\n`);

    // 既存のメトリクスを確認
    const existingMetrics = await prisma.metric.findMany({
      where: { adId: ad.id },
      orderBy: { statDate: 'asc' },
    });

    console.log(`現在のメトリクス件数: ${existingMetrics.length}件\n`);

    if (existingMetrics.length > 0) {
      console.log('削除対象のメトリクス:');
      console.log('─'.repeat(80));
      for (const m of existingMetrics) {
        const date = m.statDate.toISOString().split('T')[0];
        console.log(`  ${date} | Spend: ¥${m.spend.toFixed(2)}`);
      }
      console.log('─'.repeat(80));
      console.log('');

      // 削除実行
      const result = await prisma.metric.deleteMany({
        where: { adId: ad.id },
      });

      console.log(`✓ ${result.count}件のメトリクスを削除しました\n`);
    } else {
      console.log('削除対象のメトリクスはありません\n');
    }

    console.log('次のステップ:');
    console.log('1. schedulerを手動実行して正しいメトリクスを取得');
    console.log('2. 予算調整を実行して、正しい支出額が表示されることを確認');

  } catch (error) {
    console.error('エラーが発生しました:', error);
  } finally {
    await prisma.$disconnect();
  }
}

deleteMetrics();
