import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

async function check() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  console.log('========================================');
  console.log('3つの問題広告のメトリクス確認');
  console.log('========================================\n');

  // マイグレーション後のsmart_plus_ad_id
  const targetAds = [
    { name: '箕輪さん', smartPlusAdId: '1849925125797105' },
    { name: 'ピザ', smartPlusAdId: '1849940699726881' },
    { name: '配達員', smartPlusAdId: '1850253042082962' },
  ];

  for (const target of targetAds) {
    console.log(`\n【${target.name}】`);
    console.log(`smart_plus_ad_id: ${target.smartPlusAdId}`);
    console.log('─'.repeat(50));

    const ad = await prisma.ad.findUnique({
      where: { tiktokId: target.smartPlusAdId },
      include: {
        adGroup: {
          include: { campaign: true }
        },
        metrics: {
          orderBy: { statDate: 'desc' },
          take: 10
        }
      }
    });

    if (!ad) {
      console.log('  ✗ 広告が見つかりません');
      continue;
    }

    console.log(`  DB ID: ${ad.id}`);
    console.log(`  tiktokId: ${ad.tiktokId}`);
    console.log(`  広告名: ${ad.name}`);
    console.log(`  キャンペーン: ${ad.adGroup.campaign.name}`);
    console.log(`  ステータス: ${ad.status}`);
    console.log(`\n  メトリクス（直近10日分）:`);

    if (ad.metrics.length === 0) {
      console.log('    メトリクスなし');
    } else {
      let totalSpend = 0;
      let totalImpressions = 0;
      let totalClicks = 0;

      ad.metrics.forEach(m => {
        const date = m.statDate.toISOString().split('T')[0];
        console.log(`    ${date}: spend=¥${m.spend.toLocaleString()}, imp=${m.impressions.toLocaleString()}, clicks=${m.clicks}`);
        totalSpend += m.spend;
        totalImpressions += m.impressions;
        totalClicks += m.clicks;
      });

      console.log(`\n  合計: spend=¥${totalSpend.toLocaleString()}, imp=${totalImpressions.toLocaleString()}, clicks=${totalClicks}`);
    }
  }

  // 追加: 今日の日付でのメトリクス有無確認
  console.log('\n\n========================================');
  console.log('本日のメトリクス確認');
  console.log('========================================');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const target of targetAds) {
    const ad = await prisma.ad.findUnique({
      where: { tiktokId: target.smartPlusAdId }
    });

    if (!ad) continue;

    const todayMetric = await prisma.metric.findFirst({
      where: {
        adId: ad.id,
        statDate: {
          gte: yesterday,
          lt: today
        }
      }
    });

    const dateStr = yesterday.toISOString().split('T')[0];
    if (todayMetric) {
      console.log(`${target.name} (${dateStr}): spend=¥${todayMetric.spend.toLocaleString()}, imp=${todayMetric.impressions.toLocaleString()}`);
    } else {
      console.log(`${target.name} (${dateStr}): メトリクスなし`);
    }
  }

  await app.close();
}

check();
