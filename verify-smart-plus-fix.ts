/**
 * Smart+広告のメトリクス修正を検証
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyFix() {
  try {
    const tiktokAdId = '1848545700919346';

    console.log('========================================');
    console.log('Smart+広告メトリクス修正の検証');
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

    console.log(`✓ 広告情報:`);
    console.log(`  - 広告名: ${ad.name}`);
    console.log(`  - Advertiser: ${ad.adGroup.campaign.advertiser.name}`);
    console.log(`  - BidType: ${ad.adGroup.bidType}`);
    console.log(`  - Smart+広告: ${ad.adGroup.bidType === 'BID_TYPE_NO_BID' ? 'YES' : 'NO'}\n`);

    // メトリクスを取得
    const metrics = await prisma.metric.findMany({
      where: { adId: ad.id },
      orderBy: { statDate: 'desc' },
    });

    console.log(`✓ メトリクス件数: ${metrics.length}件\n`);

    if (metrics.length === 0) {
      console.log('⚠️  メトリクスが見つかりません。GitHub Actionsが正常に実行されたか確認してください。\n');
      return;
    }

    console.log('メトリクス詳細:');
    console.log('─'.repeat(100));
    console.log('日付       | Impressions | Clicks | Spend (円)    | 作成日時');
    console.log('─'.repeat(100));

    let totalSpend = 0;
    for (const m of metrics) {
      const date = m.statDate.toISOString().split('T')[0];
      const createdAt = m.createdAt.toISOString();
      console.log(
        `${date} | ${m.impressions.toString().padEnd(11)} | ${m.clicks.toString().padEnd(6)} | ${m.spend.toFixed(2).padEnd(13)} | ${createdAt}`
      );
      totalSpend += m.spend;
    }

    console.log('─'.repeat(100));
    console.log(`合計支出: ¥${totalSpend.toFixed(2)}\n`);

    console.log('========================================');
    console.log('検証結果');
    console.log('========================================\n');

    const expectedSpend = 98818; // 広告マネージャーの値
    const difference = Math.abs(totalSpend - expectedSpend);
    const percentDiff = (difference / expectedSpend) * 100;

    console.log(`広告マネージャーの支出: ¥${expectedSpend.toLocaleString()}`);
    console.log(`データベースの支出:     ¥${totalSpend.toLocaleString()}`);
    console.log(`差異:                   ¥${difference.toLocaleString()} (${percentDiff.toFixed(2)}%)\n`);

    if (percentDiff < 5) {
      console.log('✅ 修正成功！メトリクスが正しく取得されています。');
    } else if (percentDiff < 20) {
      console.log('⚠️  若干の差異がありますが、許容範囲内です。');
    } else {
      console.log('❌ まだ大きな差異があります。調査が必要です。');
    }

    console.log('\n注意:');
    console.log('- Smart+広告は7日間の合算値を1レコードとして保存します');
    console.log('- 最新のレコード（最も新しい日付）が現在の7日間合算値です');
    console.log('- 予算調整では、この最新レコードのみが使用されます');

  } catch (error) {
    console.error('エラーが発生しました:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyFix();
