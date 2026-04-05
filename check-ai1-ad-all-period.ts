/**
 * AI1広告の全期間メトリクスを確認
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAllPeriod() {
  try {
    const tiktokAdId = '1848545700919346';

    console.log('========================================');
    console.log('AI1広告の全期間メトリクス確認');
    console.log('========================================\n');

    const ad = await prisma.ad.findUnique({
      where: { tiktokId: tiktokAdId },
    });

    if (!ad) {
      console.log(`❌ 広告が見つかりません`);
      return;
    }

    console.log(`広告: ${ad.name}`);
    console.log(`TikTok ID: ${ad.tiktokId}\n`);

    // 全メトリクスを取得
    const allMetrics = await prisma.metric.findMany({
      where: { adId: ad.id },
      orderBy: { statDate: 'asc' },
    });

    console.log(`✓ 合計 ${allMetrics.length} 件のメトリクスレコード\n`);

    console.log('全期間のメトリクス:');
    console.log('─'.repeat(120));
    console.log('日付       | Impressions | Clicks | Spend (円)    | 作成日時');
    console.log('─'.repeat(120));

    let totalSpend = 0;

    for (const metric of allMetrics) {
      const date = metric.statDate.toISOString().split('T')[0];
      const createdAt = metric.createdAt.toISOString();

      console.log(
        `${date} | ${metric.impressions.toString().padEnd(11)} | ${metric.clicks.toString().padEnd(6)} | ${metric.spend.toFixed(2).padEnd(13)} | ${createdAt}`
      );

      totalSpend += metric.spend;
    }

    console.log('─'.repeat(120));
    console.log(`合計支出: ¥${totalSpend.toFixed(2)}\n`);

    // 11/16～11/22の期間で広告マネージャーとの比較
    console.log('========================================');
    console.log('11/16～11/22 期間の分析');
    console.log('========================================\n');

    const periodMetrics = allMetrics.filter((m) => {
      const date = m.statDate.toISOString().split('T')[0];
      return date >= '2025-11-16' && date <= '2025-11-22';
    });

    console.log('日付       | DB支出 (円) | 広告マネージャー想定 (円)');
    console.log('─'.repeat(70));
    console.log('2025-11-16 | (データなし) | ?');
    console.log('2025-11-17 | (データなし) | ?');
    console.log('2025-11-18 | (データなし) | ?');
    console.log('2025-11-19 | (データなし) | ?');
    console.log('2025-11-20 | 231,898.00  | 25,704 (実測値)');
    console.log('2025-11-21 | 192,037.00  | 40,948 (実測値)');
    console.log('2025-11-22 | (データなし) | ?');
    console.log('─'.repeat(70));

    const dbTotal = periodMetrics.reduce((sum, m) => sum + m.spend, 0);
    const expectedTotal = 98818; // 広告マネージャーの合計

    console.log(`DB合計:     ¥${dbTotal.toFixed(2)}`);
    console.log(`広告マネージャー合計: ¥${expectedTotal.toFixed(2)}`);
    console.log(`差異: ¥${(dbTotal - expectedTotal).toFixed(2)}\n`);

    console.log('問題点:');
    console.log('1. 11/16～11/19 と 11/22 のメトリクスが欠落');
    console.log('2. 11/20 と 11/21 のメトリクスが異常に高い（実測値の約9倍と4.7倍）');
    console.log('3. データベースの合計が広告マネージャーの約4.3倍\n');

    console.log('推奨対応:');
    console.log('- メトリクス同期バッチを再実行して正しいデータを取得');
    console.log('- または、TikTok APIから返される生データを確認');

  } catch (error) {
    console.error('エラーが発生しました:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAllPeriod();
