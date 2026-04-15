import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

/**
 * 支出があるメトリクスを確認するスクリプト
 */
async function checkSpendMetrics() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  console.log('========================================');
  console.log('支出メトリクス確認');
  console.log('========================================\n');

  try {
    // 1. 本日作成された支出があるメトリクス
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayWithSpend = await prisma.metric.findMany({
      where: {
        createdAt: { gte: today },
        spend: { gt: 0 },
      },
      orderBy: { spend: 'desc' },
      take: 20,
      select: {
        entityType: true,
        statDate: true,
        spend: true,
        impressions: true,
        clicks: true,
        createdAt: true,
      },
    });

    console.log(`【1】本日作成された支出 > 0 のメトリクス: ${todayWithSpend.length} 件`);
    if (todayWithSpend.length > 0) {
      console.log('\n上位20件:');
      for (const m of todayWithSpend) {
        console.log(`  ${m.entityType} | 日付: ${m.statDate.toISOString().split('T')[0]} | 支出: ¥${m.spend.toFixed(2)} | imp: ${m.impressions} | clicks: ${m.clicks}`);
      }
    }

    // 2. 日付別の支出合計（直近7日）
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const metricsWithSpend = await prisma.metric.findMany({
      where: {
        statDate: { gte: sevenDaysAgo },
        spend: { gt: 0 },
      },
      select: {
        statDate: true,
        entityType: true,
        spend: true,
      },
    });

    const spendByDateAndType: Record<string, Record<string, number>> = {};
    for (const m of metricsWithSpend) {
      const dateKey = m.statDate.toISOString().split('T')[0];
      if (!spendByDateAndType[dateKey]) {
        spendByDateAndType[dateKey] = {};
      }
      spendByDateAndType[dateKey][m.entityType] = (spendByDateAndType[dateKey][m.entityType] || 0) + m.spend;
    }

    console.log('\n【2】日付別・entityType別 支出合計（直近7日）:');
    for (const [date, types] of Object.entries(spendByDateAndType).sort()) {
      const details = Object.entries(types).map(([t, s]) => `${t}: ¥${s.toFixed(0)}`).join(', ');
      console.log(`  ${date}: ${details}`);
    }

    // 3. 11/26の支出があるメトリクス数
    const nov26Start = new Date('2025-11-26T00:00:00Z');
    const nov26End = new Date('2025-11-26T23:59:59Z');

    const nov26WithSpendCount = await prisma.metric.count({
      where: {
        statDate: { gte: nov26Start, lte: nov26End },
        spend: { gt: 0 },
      },
    });

    const nov26TotalCount = await prisma.metric.count({
      where: {
        statDate: { gte: nov26Start, lte: nov26End },
      },
    });

    console.log(`\n【3】11/26のメトリクス: 総数 ${nov26TotalCount} 件, 支出>0 ${nov26WithSpendCount} 件`);

  } catch (error: any) {
    console.error(`エラー: ${error.message}`);
  } finally {
    await app.close();
  }
}

checkSpendMetrics();
