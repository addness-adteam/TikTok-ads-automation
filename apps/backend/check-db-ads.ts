/**
 * データベースから特定の広告名を検索するスクリプト
 *
 * 検索対象:
 * - CR00679
 * - CR00680
 * - 251204/高橋海斗
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  // 検索キーワード
  const searchKeywords = ['CR00679', 'CR00680', '251204/高橋海斗', '高橋海斗', '高橋'];

  console.log('='.repeat(80));
  console.log('データベース 広告検索');
  console.log('='.repeat(80));
  console.log(`検索キーワード: ${searchKeywords.join(', ')}`);
  console.log('='.repeat(80));

  for (const keyword of searchKeywords) {
    console.log(`\n🔍 キーワード: "${keyword}"`);

    try {
      // 広告名で検索
      const ads = await prisma.ad.findMany({
        where: {
          name: {
            contains: keyword,
          },
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
          metrics: {
            orderBy: {
              statDate: 'desc',
            },
            take: 1,
          },
        },
      });

      if (ads.length > 0) {
        console.log(`  ✅ ${ads.length}件見つかりました:`);

        for (const ad of ads) {
          console.log(`  ┌${'─'.repeat(70)}`);
          console.log(`  │ 広告名: ${ad.name}`);
          console.log(`  │ TikTok広告ID: ${ad.tiktokId}`);
          console.log(`  │ DB内部ID: ${ad.id}`);
          console.log(`  │ ステータス: ${ad.status}`);
          console.log(`  │ アカウント: ${ad.adGroup.campaign.advertiser.name} (${ad.adGroup.campaign.advertiser.tiktokAdvertiserId})`);
          console.log(`  │ キャンペーン: ${ad.adGroup.campaign.name}`);
          console.log(`  │ 広告グループ: ${ad.adGroup.name}`);
          console.log(`  │ 作成日時: ${ad.createdAt}`);
          console.log(`  │ 更新日時: ${ad.updatedAt}`);

          if (ad.metrics && ad.metrics.length > 0) {
            const metric = ad.metrics[0];
            console.log(`  │ ──────────────────────────────────────────────`);
            console.log(`  │ 最新メトリクス (${metric.statDate.toISOString().split('T')[0]}):`);
            console.log(`  │   インプレッション数: ${metric.impressions}`);
            console.log(`  │   クリック数: ${metric.clicks}`);
            console.log(`  │   支出 (Spend): ${metric.spend}`);
            console.log(`  │   コンバージョン数: ${metric.conversions}`);
          } else {
            console.log(`  │ メトリクス: なし`);
          }

          console.log(`  └${'─'.repeat(70)}`);
        }
      } else {
        console.log(`  ❌ 見つかりませんでした`);
      }
    } catch (error: any) {
      console.error(`  ⚠️  エラー: ${error.message}`);
    }
  }

  // 全体の広告数を表示
  console.log('\n' + '='.repeat(80));
  console.log('データベース統計:');
  console.log('='.repeat(80));

  try {
    const totalAds = await prisma.ad.count();
    console.log(`総広告数: ${totalAds}`);

    // アカウントごとの広告数
    const adsByAdvertiser = await prisma.ad.groupBy({
      by: ['adgroupId'],
      _count: true,
    });

    // CR番号を含む広告数
    const crAds = await prisma.ad.count({
      where: {
        name: {
          contains: 'CR',
        },
      },
    });
    console.log(`CR番号を含む広告数: ${crAds}`);

    // 251204を含む広告数
    const dateAds = await prisma.ad.count({
      where: {
        name: {
          contains: '251204',
        },
      },
    });
    console.log(`「251204」を含む広告数: ${dateAds}`);

    // 高橋を含む広告数
    const takahasiAds = await prisma.ad.count({
      where: {
        name: {
          contains: '高橋',
        },
      },
    });
    console.log(`「高橋」を含む広告数: ${takahasiAds}`);

  } catch (error: any) {
    console.error(`統計取得エラー: ${error.message}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('検索完了');
  console.log('='.repeat(80));

  await app.close();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
