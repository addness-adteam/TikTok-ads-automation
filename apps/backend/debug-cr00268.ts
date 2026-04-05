/**
 * CR00268の広告費差異を調査するデバッグスクリプト
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('=== CR00268 広告費差異調査 ===\n');

  // CR00268を含む広告名を検索
  const ads = await prisma.ad.findMany({
    where: {
      name: { contains: 'CR00268' },
    },
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

  console.log(`CR00268を含む広告数: ${ads.length}\n`);

  for (const ad of ads) {
    console.log(`=== 広告ID: ${ad.tiktokId} ===`);
    console.log(`広告名: ${ad.name}`);
    console.log(`DB内部ID: ${ad.id}`);
    console.log(`広告主: ${ad.adGroup.campaign.advertiser.name} (${ad.adGroup.campaign.advertiser.tiktokAdvertiserId})`);
    console.log(`ステータス: ${ad.status}`);
    console.log(`作成日: ${ad.createdAt}`);

    // この広告のメトリクスを取得
    const metrics = await prisma.metric.findMany({
      where: {
        adId: ad.id,
        entityType: 'AD',
      },
      orderBy: { statDate: 'asc' },
    });

    console.log(`\nメトリクス数: ${metrics.length}`);

    if (metrics.length > 0) {
      console.log('\n日別メトリクス:');
      let totalSpend = 0;
      for (const m of metrics) {
        console.log(`  ${m.statDate.toISOString().split('T')[0]}: spend=¥${m.spend.toFixed(0)}, imp=${m.impressions}, clicks=${m.clicks}`);
        totalSpend += m.spend;
      }
      console.log(`\n全期間合計spend: ¥${totalSpend.toFixed(0)}`);

      // 最初のspend > 0の日を特定
      const firstSpendMetric = metrics.find(m => m.spend > 0);
      if (firstSpendMetric) {
        const startDate = new Date(firstSpendMetric.statDate);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 2); // 3日間（開始日含む）

        console.log(`\n配信開始日（spend>0の最初の日）: ${startDate.toISOString().split('T')[0]}`);
        console.log(`初動3日間の終了日: ${endDate.toISOString().split('T')[0]}`);

        // 初動3日間のspendを計算
        let initialSpend = 0;
        for (const m of metrics) {
          const mDate = new Date(m.statDate);
          if (mDate >= startDate && mDate <= endDate) {
            initialSpend += m.spend;
            console.log(`  [初動] ${mDate.toISOString().split('T')[0]}: ¥${m.spend.toFixed(0)}`);
          }
        }
        console.log(`\n初動3日間のspend合計: ¥${initialSpend.toFixed(0)}`);
      }
    }

    console.log('\n' + '='.repeat(50) + '\n');
  }

  // TikTok広告IDで直接検索（APIで取得したIDで）
  console.log('\n=== TikTok広告ID検索 ===');

  // 元のスクリプトで出力されたCR00268のad_idを検索
  const targetAdName = '260113/鈴木織大/おーい会社員_お互い学習系/LP2-CR00268';
  const exactAd = await prisma.ad.findFirst({
    where: { name: targetAdName },
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

  if (exactAd) {
    console.log(`\n正確な広告名で検索:`)
    console.log(`広告ID: ${exactAd.tiktokId}`);
    console.log(`DB内部ID: ${exactAd.id}`);
  } else {
    console.log(`広告名「${targetAdName}」は見つかりませんでした`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
