/**
 * AI1広告の階層構造とメトリクスを確認
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAdHierarchy() {
  try {
    const tiktokAdId = '1848545700919346';

    console.log('========================================');
    console.log('AI1広告の階層構造とメトリクス確認');
    console.log('========================================\n');

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
            ads: true, // 同じAdGroup内の他の広告
          },
        },
      },
    });

    if (!ad) {
      console.log(`❌ 広告が見つかりません`);
      return;
    }

    console.log('【広告情報】');
    console.log(`  広告名: ${ad.name}`);
    console.log(`  広告ID (TikTok): ${ad.tiktokId}`);
    console.log(`  広告ID (DB): ${ad.id}`);
    console.log(`  ステータス: ${ad.status}\n`);

    console.log('【AdGroup情報】');
    console.log(`  AdGroup名: ${ad.adGroup.name}`);
    console.log(`  AdGroup ID (TikTok): ${ad.adGroup.tiktokId}`);
    console.log(`  AdGroup ID (DB): ${ad.adGroup.id}`);
    console.log(`  同じAdGroup内の広告数: ${ad.adGroup.ads.length}件\n`);

    console.log('【Campaign情報】');
    console.log(`  Campaign名: ${ad.adGroup.campaign.name}`);
    console.log(`  Campaign ID (TikTok): ${ad.adGroup.campaign.tiktokId}`);
    console.log(`  Campaign ID (DB): ${ad.adGroup.campaign.id}\n`);

    // 11/20と11/21のメトリクスを各レベルで確認
    const dates = ['2025-11-20', '2025-11-21'];

    for (const dateStr of dates) {
      const date = new Date(dateStr + 'T00:00:00+09:00');

      console.log(`\n========================================`);
      console.log(`${dateStr} のメトリクス比較`);
      console.log(`========================================\n`);

      // ADレベル
      const adMetrics = await prisma.metric.findMany({
        where: {
          entityType: 'AD',
          adId: ad.id,
          statDate: date,
        },
      });

      console.log('【ADレベル】');
      if (adMetrics.length === 0) {
        console.log('  データなし');
      } else {
        adMetrics.forEach((m, i) => {
          console.log(`  レコード ${i + 1}:`);
          console.log(`    Impressions: ${m.impressions}`);
          console.log(`    Clicks: ${m.clicks}`);
          console.log(`    Spend: ¥${m.spend.toFixed(2)}`);
        });
      }

      // ADGROUPレベル
      const adgroupMetrics = await prisma.metric.findMany({
        where: {
          entityType: 'ADGROUP',
          adgroupId: ad.adGroup.id,
          statDate: date,
        },
      });

      console.log('\n【ADGROUPレベル】');
      if (adgroupMetrics.length === 0) {
        console.log('  データなし');
      } else {
        adgroupMetrics.forEach((m, i) => {
          console.log(`  レコード ${i + 1}:`);
          console.log(`    Impressions: ${m.impressions}`);
          console.log(`    Clicks: ${m.clicks}`);
          console.log(`    Spend: ¥${m.spend.toFixed(2)}`);
        });
      }

      // CAMPAIGNレベル
      const campaignMetrics = await prisma.metric.findMany({
        where: {
          entityType: 'CAMPAIGN',
          campaignId: ad.adGroup.campaign.id,
          statDate: date,
        },
      });

      console.log('\n【CAMPAIGNレベル】');
      if (campaignMetrics.length === 0) {
        console.log('  データなし');
      } else {
        campaignMetrics.forEach((m, i) => {
          console.log(`  レコード ${i + 1}:`);
          console.log(`    Impressions: ${m.impressions}`);
          console.log(`    Clicks: ${m.clicks}`);
          console.log(`    Spend: ¥${m.spend.toFixed(2)}`);
        });
      }
    }

    console.log('\n========================================');
    console.log('分析');
    console.log('========================================\n');
    console.log('ADレベルのメトリクスが異常に高い場合、以下の可能性があります:');
    console.log('1. TikTok APIからADGROUPまたはCAMPAIGNレベルのデータが返されている');
    console.log('2. 同じAdGroup内の複数の広告のデータが合算されている');
    console.log('3. メトリクス保存ロジックにバグがある');

  } catch (error) {
    console.error('エラーが発生しました:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAdHierarchy();
