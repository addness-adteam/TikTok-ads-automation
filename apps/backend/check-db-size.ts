import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { PrismaClient } from '@prisma/client';

async function main() {
  const p = new PrismaClient();

  const snapTotal = await p.hourlyOptimizationSnapshot.count();
  const snapOldest = await p.hourlyOptimizationSnapshot.findFirst({ orderBy: { executionTime: 'asc' }, select: { executionTime: true } });
  const snapNewest = await p.hourlyOptimizationSnapshot.findFirst({ orderBy: { executionTime: 'desc' }, select: { executionTime: true } });

  const metricTotal = await p.metric.count();
  const metricOldest = await p.metric.findFirst({ orderBy: { statDate: 'asc' }, select: { statDate: true } });
  const metricNewest = await p.metric.findFirst({ orderBy: { statDate: 'desc' }, select: { statDate: true } });

  const changeLogTotal = await p.changeLog.count();
  const changeLogOldest = await p.changeLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } });

  console.log('=== 主要テーブルの行数と範囲 ===');
  console.log(`HourlyOptimizationSnapshot: ${snapTotal.toLocaleString()}行 / ${snapOldest?.executionTime.toISOString().slice(0,10)} ~ ${snapNewest?.executionTime.toISOString().slice(0,10)}`);
  console.log(`Metric: ${metricTotal.toLocaleString()}行 / ${metricOldest?.statDate.toISOString().slice(0,10)} ~ ${metricNewest?.statDate.toISOString().slice(0,10)}`);
  console.log(`ChangeLog: ${changeLogTotal.toLocaleString()}行 / ${changeLogOldest?.createdAt.toISOString().slice(0,10)} ~ 現在`);

  // DBサイズ推定（Postgres システム関数）
  const sizeRaw = await p.$queryRaw<{ table: string; size: string; rows: number }[]>`
    SELECT
      c.relname AS "table",
      pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
      COALESCE(s.n_live_tup, 0)::int AS rows
    FROM pg_class c
    LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE c.relkind = 'r' AND n.nspname = 'public'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 15;
  `;
  console.log('\n=== Postgres 上位15テーブルのサイズ ===');
  for (const r of sizeRaw) console.log(`  ${r.size.padStart(10)} | ${String(r.rows).padStart(9)}行 | ${r.table}`);

  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
