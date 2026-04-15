import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 12/29の深夜～翌朝にかけてのDB操作を確認（サーバー活動の証跡）
  console.log('=== 12/29 22:00 - 12/30 02:00 のDB活動 ===\n');

  // 1. メトリクス更新（0:05のバッチジョブ）
  console.log('--- Metricテーブル (createdAt) ---');
  const metricsAroundMidnight = await prisma.metric.findMany({
    where: {
      createdAt: {
        gte: new Date('2025-12-29T13:00:00.000Z'), // JST 22:00
        lte: new Date('2025-12-29T17:00:00.000Z'), // JST 02:00
      }
    },
    orderBy: { createdAt: 'asc' },
    take: 10,
  });
  console.log(`Found ${metricsAroundMidnight.length} metrics`);
  for (const m of metricsAroundMidnight) {
    console.log(`  ${m.createdAt.toISOString()}`);
  }

  // 2. ChangeLog
  console.log('\n--- ChangeLog (12/29 22:00 - 12/30 02:00) ---');
  const changeLogs = await prisma.changeLog.findMany({
    where: {
      createdAt: {
        gte: new Date('2025-12-29T13:00:00.000Z'), // JST 22:00
        lte: new Date('2025-12-29T17:00:00.000Z'), // JST 02:00
      }
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Found ${changeLogs.length} change logs`);
  for (const log of changeLogs) {
    console.log(`  ${log.createdAt.toISOString()} | ${log.action}`);
  }

  // 3. Notification
  console.log('\n--- Notification (12/29 22:00 - 12/30 02:00) ---');
  const notifications = await prisma.notification.findMany({
    where: {
      createdAt: {
        gte: new Date('2025-12-29T13:00:00.000Z'),
        lte: new Date('2025-12-29T17:00:00.000Z'),
      }
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Found ${notifications.length} notifications`);
  for (const n of notifications) {
    console.log(`  ${n.createdAt.toISOString()} | ${n.type}`);
  }

  // 4. 12/30 0時のメトリクス同期が行われたか確認
  console.log('\n--- 12/30 0:00-0:10 のMetric作成 ---');
  const metricsAt0AM = await prisma.metric.findMany({
    where: {
      createdAt: {
        gte: new Date('2025-12-29T15:00:00.000Z'), // JST 0:00
        lte: new Date('2025-12-29T15:10:00.000Z'), // JST 0:10
      }
    },
    orderBy: { createdAt: 'asc' },
    take: 10,
  });
  console.log(`Found ${metricsAt0AM.length} metrics around midnight`);
  for (const m of metricsAt0AM) {
    console.log(`  ${m.createdAt.toISOString()}`);
  }

  // 5. 最新のメトリクス作成時刻
  console.log('\n--- 最新のMetric ---');
  const latestMetric = await prisma.metric.findFirst({
    orderBy: { createdAt: 'desc' },
  });
  if (latestMetric) {
    console.log(`Latest: ${latestMetric.createdAt.toISOString()}`);
  }

  // 6. APIログがあれば確認
  console.log('\n--- APILog (12/29 22:00 - 12/30 02:00) ---');
  try {
    const apiLogs = await prisma.aPILog.findMany({
      where: {
        createdAt: {
          gte: new Date('2025-12-29T13:00:00.000Z'),
          lte: new Date('2025-12-29T17:00:00.000Z'),
        }
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    console.log(`Found ${apiLogs.length} API logs`);
  } catch (e) {
    console.log('APILog table not found or error');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
