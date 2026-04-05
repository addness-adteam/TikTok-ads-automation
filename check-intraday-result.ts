import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkIntradayResult() {
  // 本日の日付（JST）
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);
  const todayStr = jstNow.toISOString().split('T')[0];

  console.log(`\n=== 日中CPA最適化 実行結果確認 ===`);
  console.log(`日付: ${todayStr} (JST)\n`);

  // 1. 停止された広告を確認
  const pauseLogs = await prisma.intradayPauseLog.findMany({
    where: {
      pauseTime: {
        gte: new Date(todayStr + 'T00:00:00+09:00'),
        lt: new Date(todayStr + 'T23:59:59+09:00'),
      },
    },
    orderBy: { pauseTime: 'desc' },
  });

  console.log(`\n【停止された広告】: ${pauseLogs.length}件`);
  for (const log of pauseLogs) {
    console.log(`  - 広告ID: ${log.adId}`);
    console.log(`    広告主ID: ${log.advertiserId}`);
    console.log(`    停止時刻: ${log.pauseTime?.toISOString()}`);
    console.log(`    停止理由: ${log.pauseReason}`);
    console.log(`    当日消化: ¥${log.todaySpend?.toFixed(0) || '-'}`);
    console.log(`    当日CPA: ¥${log.todayCPA?.toFixed(0) || '-'}`);
    console.log(`    前日CPA: ¥${log.yesterdayCPA?.toFixed(0) || '-'}`);
    console.log(`    再開済み: ${log.resumed ? 'Yes' : 'No'}`);
    console.log('');
  }

  // 2. 予算削減された広告を確認
  const reductionLogs = await prisma.intradayBudgetReductionLog.findMany({
    where: {
      reductionTime: {
        gte: new Date(todayStr + 'T00:00:00+09:00'),
        lt: new Date(todayStr + 'T23:59:59+09:00'),
      },
    },
    orderBy: { reductionTime: 'desc' },
  });

  console.log(`\n【予算削減された広告】: ${reductionLogs.length}件`);
  for (const log of reductionLogs) {
    console.log(`  - 広告グループID: ${log.adgroupId}`);
    console.log(`    キャンペーンID: ${log.campaignId || '-'}`);
    console.log(`    広告主ID: ${log.advertiserId}`);
    console.log(`    削減時刻: ${log.reductionTime?.toISOString()}`);
    console.log(`    元予算: ¥${log.originalBudget?.toLocaleString()}`);
    console.log(`    削減後: ¥${log.reducedBudget?.toLocaleString()}`);
    console.log(`    CBO: ${log.isCBO ? 'Yes' : 'No'}`);
    console.log(`    復元済み: ${log.restored ? 'Yes' : 'No'}`);
    console.log('');
  }

  // 3. 関連するChangeLogを確認
  const changeLogs = await prisma.changeLog.findMany({
    where: {
      source: 'INTRADAY_OPTIMIZATION',
      createdAt: {
        gte: new Date(todayStr + 'T00:00:00+09:00'),
        lt: new Date(todayStr + 'T23:59:59+09:00'),
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`\n【変更ログ】: ${changeLogs.length}件`);
  for (const log of changeLogs) {
    console.log(`  - エンティティ: ${log.entityType} (${log.entityId})`);
    console.log(`    アクション: ${log.action}`);
    console.log(`    時刻: ${log.createdAt.toISOString()}`);
    console.log(`    理由: ${log.reason}`);
    console.log(`    変更前: ${JSON.stringify(log.beforeData)}`);
    console.log(`    変更後: ${JSON.stringify(log.afterData)}`);
    console.log('');
  }

  // 4. 関連する通知を確認
  const notifications = await prisma.notification.findMany({
    where: {
      type: {
        in: ['INTRADAY_CPA_PAUSE', 'INTRADAY_BUDGET_REDUCED'],
      },
      createdAt: {
        gte: new Date(todayStr + 'T00:00:00+09:00'),
        lt: new Date(todayStr + 'T23:59:59+09:00'),
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`\n【通知】: ${notifications.length}件`);
  for (const notif of notifications) {
    console.log(`  - タイトル: ${notif.title}`);
    console.log(`    タイプ: ${notif.type}`);
    console.log(`    重要度: ${notif.severity}`);
    console.log(`    時刻: ${notif.createdAt.toISOString()}`);
    console.log(`    メッセージ: ${notif.message}`);
    console.log(`    メタデータ: ${JSON.stringify(notif.metadata)}`);
    console.log('');
  }

  // 5. 関連する広告主情報
  const advertiserIds = [
    ...new Set([...pauseLogs.map((l) => l.advertiserId), ...reductionLogs.map((l) => l.advertiserId)]),
  ];

  if (advertiserIds.length > 0) {
    console.log('\n【関連する広告主・Appeal情報】');
    for (const advId of advertiserIds) {
      const advertiser = await prisma.advertiser.findUnique({
        where: { tiktokAdvertiserId: advId },
        include: { appeal: true },
      });
      if (advertiser) {
        console.log(`  - 広告主ID: ${advId}`);
        console.log(`    名前: ${advertiser.name}`);
        console.log(`    Appeal: ${advertiser.appeal?.name || '-'}`);
        console.log(`    目標CPA: ¥${advertiser.appeal?.targetCPA?.toLocaleString() || '-'}`);
        console.log(`    許容CPA: ¥${advertiser.appeal?.allowableCPA?.toLocaleString() || '-'}`);
        console.log('');
      }
    }
  }

  // 6. サマリー
  console.log('\n=== サマリー ===');
  console.log(`停止された広告: ${pauseLogs.length}件`);
  console.log(`予算削減された広告: ${reductionLogs.length}件`);
  console.log(`変更ログ: ${changeLogs.length}件`);
  console.log(`通知: ${notifications.length}件`);

  if (pauseLogs.length === 0 && reductionLogs.length === 0) {
    console.log('\n→ 本日は停止・予算削減の対象となる広告はありませんでした。');
    console.log('  （全広告がCPA基準を満たしているか、対象となる配信中の広告がなかった可能性があります）');
  }
}

checkIntradayResult()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
