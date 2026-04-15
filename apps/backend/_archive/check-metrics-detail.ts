import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

/**
 * メトリクスの詳細を確認するスクリプト
 */
async function checkMetricsDetail() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  console.log('========================================');
  console.log('メトリクス詳細確認');
  console.log('========================================\n');

  try {
    // 1. entityType別のメトリクス数
    const metricsByType = await prisma.metric.groupBy({
      by: ['entityType'],
      _count: { id: true },
    });

    console.log('【1】entityType別メトリクス数:');
    for (const m of metricsByType) {
      console.log(`  ${m.entityType}: ${m._count.id} 件`);
    }

    // 2. 最新のメトリクスを確認
    const latestMetrics = await prisma.metric.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        entityType: true,
        statDate: true,
        spend: true,
        impressions: true,
        clicks: true,
        createdAt: true,
      },
    });

    console.log('\n【2】最新のメトリクス（10件）:');
    for (const m of latestMetrics) {
      console.log(`  ${m.entityType} | 日付: ${m.statDate.toISOString().split('T')[0]} | 支出: ¥${m.spend} | imp: ${m.impressions} | 作成: ${m.createdAt.toISOString()}`);
    }

    // 3. 日付別のメトリクス数（直近10日）
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const recentMetrics = await prisma.metric.findMany({
      where: {
        statDate: { gte: tenDaysAgo },
      },
      select: {
        statDate: true,
        entityType: true,
      },
    });

    const byDateAndType: Record<string, Record<string, number>> = {};
    for (const m of recentMetrics) {
      const dateKey = m.statDate.toISOString().split('T')[0];
      if (!byDateAndType[dateKey]) {
        byDateAndType[dateKey] = {};
      }
      byDateAndType[dateKey][m.entityType] = (byDateAndType[dateKey][m.entityType] || 0) + 1;
    }

    console.log('\n【3】日付別・entityType別メトリクス数（直近10日）:');
    for (const [date, types] of Object.entries(byDateAndType).sort()) {
      const details = Object.entries(types).map(([t, c]) => `${t}:${c}`).join(', ');
      console.log(`  ${date}: ${details}`);
    }

    // 4. statDateの最新と最古を確認
    const oldestMetric = await prisma.metric.findFirst({
      orderBy: { statDate: 'asc' },
      select: { statDate: true },
    });

    const newestMetric = await prisma.metric.findFirst({
      orderBy: { statDate: 'desc' },
      select: { statDate: true },
    });

    console.log('\n【4】メトリクスの日付範囲:');
    console.log(`  最古: ${oldestMetric?.statDate?.toISOString().split('T')[0] || 'なし'}`);
    console.log(`  最新: ${newestMetric?.statDate?.toISOString().split('T')[0] || 'なし'}`);

    // 5. 今日作成されたメトリクス数
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCreatedCount = await prisma.metric.count({
      where: {
        createdAt: { gte: today },
      },
    });

    console.log(`\n【5】本日作成されたメトリクス数: ${todayCreatedCount} 件`);

  } catch (error: any) {
    console.error(`エラー: ${error.message}`);
  } finally {
    await app.close();
  }
}

checkMetricsDetail();
