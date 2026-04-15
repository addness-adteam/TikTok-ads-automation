import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { PrismaClient } from '@prisma/client';

async function main() {
  const p = new PrismaClient();
  // 4/14 0:00 と 4/15 0:00 のリセットログを広く探す
  const logs = await p.changeLog.findMany({
    where: {
      createdAt: { gte: new Date('2026-04-13T15:00:00Z'), lt: new Date('2026-04-15T16:00:00Z') },
      OR: [
        { action: { contains: 'BUDGET' } },
        { action: { contains: 'RESET' } },
        { reason: { contains: 'リセット' } },
        { source: 'BUDGET_RESET' },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`対象ChangeLog: ${logs.length}件`);
  // 日別集計
  const byDay = new Map<string, number>();
  for (const l of logs) {
    const jst = new Date(l.createdAt.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    byDay.set(jst, (byDay.get(jst) ?? 0) + 1);
  }
  console.log('日別件数:');
  for (const [d, n] of [...byDay.entries()].sort()) console.log(`  ${d}: ${n}件`);

  // 4/15 0:00台のログをサンプル表示
  console.log(`\n4/15 0:00〜1:00 JSTのログ (先頭20件):`);
  const morning = logs.filter(l => {
    const h = new Date(l.createdAt.getTime() + 9*3600*1000).toISOString().slice(11, 13);
    const d = new Date(l.createdAt.getTime() + 9*3600*1000).toISOString().slice(0, 10);
    return d === '2026-04-15' && h < '02';
  });
  for (const l of morning.slice(0, 20)) {
    const jst = new Date(l.createdAt.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    console.log(`  ${jst} | ${l.action} | ${l.entityType} ${l.entityId.slice(-10)} | ${l.reason?.slice(0, 120) ?? ''}`);
  }
  console.log(`\n4/15 0-2時のログ総件数: ${morning.length}`);

  // 対象adgroupのリセットログ検索
  const targetAdGroupId = '1862269457757569';
  const targetLogs = logs.filter(l => l.entityId === targetAdGroupId);
  console.log(`\n対象AdGroup (${targetAdGroupId}) のリセット系ログ: ${targetLogs.length}件`);
  for (const l of targetLogs) {
    const jst = new Date(l.createdAt.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    console.log(`  ${jst} | ${l.action} | reason=${l.reason}`);
    console.log(`    before=${JSON.stringify(l.beforeData).slice(0, 200)}`);
    console.log(`    after=${JSON.stringify(l.afterData).slice(0, 200)}`);
  }

  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
