/**
 * ゾンビMetric削除スクリプト
 *
 * 連続日で (spend, impressions, conversions) が完全一致するMetric行の、
 * 2日目以降を削除（初日＝7日累計だが実データ由来なので保持）。
 *
 * デフォルトdry-run。実行は `--execute` を指定。
 * 対象は全AdvertiserのMetric（AIに限らず全体）。
 */
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';

const EXECUTE = process.argv.includes('--execute');
const PERIOD_START = new Date('2026-03-01T00:00:00Z');
const PERIOD_END = new Date('2026-04-20T00:00:00Z');

async function main() {
  const prisma = new PrismaClient();
  console.log(`Mode: ${EXECUTE ? '⚠️ EXECUTE (DELETE)' : 'DRY-RUN'}`);

  const metrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      statDate: { gte: PERIOD_START, lt: PERIOD_END },
    },
    orderBy: [{ adId: 'asc' }, { statDate: 'asc' }],
  });
  console.log(`対象metric行: ${metrics.length}`);

  const byAd = new Map<string, typeof metrics>();
  for (const m of metrics) {
    if (!m.adId) continue;
    if (!byAd.has(m.adId)) byAd.set(m.adId, []);
    byAd.get(m.adId)!.push(m);
  }

  const deleteIds: string[] = [];
  let phantomSpend = 0;
  for (const [, rows] of byAd) {
    if (rows.length < 2) continue;
    let i = 0;
    while (i < rows.length) {
      const base = rows[i];
      if (base.spend < 1) { i++; continue; }
      let j = i + 1;
      while (j < rows.length &&
             Math.abs(rows[j].spend - base.spend) < 1 &&
             rows[j].impressions === base.impressions &&
             rows[j].conversions === base.conversions) {
        // 2日目以降は削除対象
        deleteIds.push(rows[j].id);
        phantomSpend += rows[j].spend;
        j++;
      }
      i = j;
    }
  }
  console.log(`削除対象: ${deleteIds.length}行 (phantom spend総額 ¥${Math.round(phantomSpend).toLocaleString()})`);

  if (!EXECUTE) {
    console.log('\n--execute を付けて再実行すると削除します');
    await prisma.$disconnect();
    return;
  }

  // 本番削除（バッチ）
  const BATCH = 500;
  for (let i = 0; i < deleteIds.length; i += BATCH) {
    const batch = deleteIds.slice(i, i + BATCH);
    const res = await prisma.metric.deleteMany({ where: { id: { in: batch } } });
    console.log(`  ${i + batch.length}/${deleteIds.length} 削除 (batch ${res.count})`);
  }
  console.log('✅ 削除完了');
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
