import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

/**
 * 広告グループの支出同期を検証するスクリプト
 *
 * 本番環境で実行して、以下を確認:
 * 1. 広告グループがDBに同期されているか
 * 2. メトリクス（特にspend）が正しく保存されているか
 * 3. 最新の同期日時
 */
async function verifyAdgroupSpendSync() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  console.log('========================================');
  console.log('広告グループ支出同期 検証レポート');
  console.log('========================================');
  console.log(`実行日時: ${new Date().toISOString()}\n`);

  try {
    // 1. 広告グループの総数を確認
    const adgroupCount = await prisma.adGroup.count();
    console.log(`【1】広告グループ総数: ${adgroupCount} 件\n`);

    // 2. 広告グループ別メトリクスの確認（直近7日間）
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const adgroupMetrics = await prisma.metric.findMany({
      where: {
        entityType: 'adgroup',
        statDate: { gte: sevenDaysAgo },
      },
      orderBy: { statDate: 'desc' },
      take: 50,
    });

    console.log(`【2】広告グループメトリクス（直近7日間）: ${adgroupMetrics.length} 件`);

    if (adgroupMetrics.length > 0) {
      console.log('\n日付別 支出サマリ:');
      const spendByDate: Record<string, { count: number; totalSpend: number }> = {};

      for (const m of adgroupMetrics) {
        const dateKey = m.statDate.toISOString().split('T')[0];
        if (!spendByDate[dateKey]) {
          spendByDate[dateKey] = { count: 0, totalSpend: 0 };
        }
        spendByDate[dateKey].count++;
        spendByDate[dateKey].totalSpend += m.spend;
      }

      for (const [date, data] of Object.entries(spendByDate).sort()) {
        console.log(`  ${date}: ${data.count}件, 合計支出: ¥${data.totalSpend.toFixed(2)}`);
      }
    }

    // 3. 広告（ad）レベルのメトリクスも確認
    const adMetrics = await prisma.metric.findMany({
      where: {
        entityType: 'ad',
        statDate: { gte: sevenDaysAgo },
      },
      orderBy: { statDate: 'desc' },
      take: 50,
    });

    console.log(`\n【3】広告メトリクス（直近7日間）: ${adMetrics.length} 件`);

    if (adMetrics.length > 0) {
      console.log('\n日付別 支出サマリ:');
      const adSpendByDate: Record<string, { count: number; totalSpend: number }> = {};

      for (const m of adMetrics) {
        const dateKey = m.statDate.toISOString().split('T')[0];
        if (!adSpendByDate[dateKey]) {
          adSpendByDate[dateKey] = { count: 0, totalSpend: 0 };
        }
        adSpendByDate[dateKey].count++;
        adSpendByDate[dateKey].totalSpend += m.spend;
      }

      for (const [date, data] of Object.entries(adSpendByDate).sort()) {
        console.log(`  ${date}: ${data.count}件, 合計支出: ¥${data.totalSpend.toFixed(2)}`);
      }
    }

    // 4. spend > 0 のメトリクスがあるか確認
    const metricsWithSpend = await prisma.metric.count({
      where: {
        spend: { gt: 0 },
        statDate: { gte: sevenDaysAgo },
      },
    });

    console.log(`\n【4】支出がある(spend > 0)メトリクス数: ${metricsWithSpend} 件`);

    // 5. 最新の同期状態（updatedAtで確認）
    const latestAdgroup = await prisma.adGroup.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { name: true, tiktokId: true, updatedAt: true },
    });

    if (latestAdgroup) {
      console.log(`\n【5】最後に更新された広告グループ:`);
      console.log(`  名前: ${latestAdgroup.name}`);
      console.log(`  TikTok ID: ${latestAdgroup.tiktokId}`);
      console.log(`  更新日時: ${latestAdgroup.updatedAt.toISOString()}`);
    }

    // 6. 広告主ごとの広告グループ数
    const adgroupsByAdvertiser = await prisma.adGroup.groupBy({
      by: ['campaignId'],
      _count: { id: true },
    });

    console.log(`\n【6】キャンペーン別 広告グループ数: ${adgroupsByAdvertiser.length} キャンペーン`);

    console.log('\n========================================');
    console.log('検証完了');
    console.log('========================================');

  } catch (error: any) {
    console.error(`エラーが発生しました: ${error.message}`);
    console.error(error.stack);
  } finally {
    await app.close();
  }
}

verifyAdgroupSpendSync();
