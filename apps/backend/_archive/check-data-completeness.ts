import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

/**
 * 過去7日間のデータ完全性を確認するスクリプト
 */
async function checkDataCompleteness() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  console.log('========================================');
  console.log('過去7日間データ完全性チェック');
  console.log('========================================\n');

  try {
    // 過去7日間の日付を生成
    const dates: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }

    console.log('【1】日付別メトリクス数（過去7日間）:\n');
    console.log('日付       | AD件数 | ADGROUP件数 | CAMPAIGN件数 | AD支出>0 | ADGROUP支出>0');
    console.log('-'.repeat(85));

    for (const dateStr of dates.sort()) {
      const startOfDay = new Date(dateStr + 'T00:00:00Z');
      const endOfDay = new Date(dateStr + 'T23:59:59Z');

      const [adCount, adgroupCount, campaignCount, adWithSpend, adgroupWithSpend] = await Promise.all([
        prisma.metric.count({
          where: { statDate: { gte: startOfDay, lte: endOfDay }, entityType: 'AD' },
        }),
        prisma.metric.count({
          where: { statDate: { gte: startOfDay, lte: endOfDay }, entityType: 'ADGROUP' },
        }),
        prisma.metric.count({
          where: { statDate: { gte: startOfDay, lte: endOfDay }, entityType: 'CAMPAIGN' },
        }),
        prisma.metric.count({
          where: { statDate: { gte: startOfDay, lte: endOfDay }, entityType: 'AD', spend: { gt: 0 } },
        }),
        prisma.metric.count({
          where: { statDate: { gte: startOfDay, lte: endOfDay }, entityType: 'ADGROUP', spend: { gt: 0 } },
        }),
      ]);

      console.log(
        `${dateStr} | ${adCount.toString().padStart(6)} | ${adgroupCount.toString().padStart(11)} | ${campaignCount.toString().padStart(12)} | ${adWithSpend.toString().padStart(8)} | ${adgroupWithSpend.toString().padStart(13)}`
      );
    }

    // 2. DBに登録されているエンティティ数との比較
    const [totalAds, totalAdgroups, totalCampaigns] = await Promise.all([
      prisma.ad.count(),
      prisma.adGroup.count(),
      prisma.campaign.count(),
    ]);

    console.log('\n【2】DBに登録されているエンティティ数:');
    console.log(`  広告(Ad): ${totalAds} 件`);
    console.log(`  広告グループ(AdGroup): ${totalAdgroups} 件`);
    console.log(`  キャンペーン(Campaign): ${totalCampaigns} 件`);

    // 3. 広告主別のエンティティ数
    const advertiserStats = await prisma.advertiser.findMany({
      include: {
        _count: {
          select: {
            campaigns: true,
          },
        },
      },
    });

    console.log('\n【3】広告主別キャンペーン数:');
    for (const adv of advertiserStats) {
      console.log(`  ${adv.name || adv.tiktokAdvertiserId}: ${adv._count.campaigns} キャンペーン`);
    }

    // 4. 本日（11/27）のデータがあるか確認
    const todayStr = new Date().toISOString().split('T')[0];
    const todayStart = new Date(todayStr + 'T00:00:00Z');
    const todayEnd = new Date(todayStr + 'T23:59:59Z');

    const todayMetrics = await prisma.metric.count({
      where: { statDate: { gte: todayStart, lte: todayEnd } },
    });

    console.log(`\n【4】本日(${todayStr})のメトリクス数: ${todayMetrics} 件`);
    console.log('   ※ 通常、本日分は翌日に取得されるため0件が正常です');

    // 5. 欠損の可能性チェック
    console.log('\n【5】欠損の可能性チェック:');

    // 直近の日付でメトリクス数が極端に少ない日がないかチェック
    let hasIssue = false;
    for (const dateStr of dates.sort()) {
      const startOfDay = new Date(dateStr + 'T00:00:00Z');
      const endOfDay = new Date(dateStr + 'T23:59:59Z');

      const adCount = await prisma.metric.count({
        where: { statDate: { gte: startOfDay, lte: endOfDay }, entityType: 'AD' },
      });

      if (adCount < 100) {
        console.log(`  ⚠️  ${dateStr}: 広告メトリクスが ${adCount} 件と少ない可能性があります`);
        hasIssue = true;
      }
    }

    if (!hasIssue) {
      console.log('  ✅ 各日付に十分なメトリクスが存在しています');
    }

    console.log('\n========================================');
    console.log('チェック完了');
    console.log('========================================');

  } catch (error: any) {
    console.error(`エラー: ${error.message}`);
  } finally {
    await app.close();
  }
}

checkDataCompleteness();
