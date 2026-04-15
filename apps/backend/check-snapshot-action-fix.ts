import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  // 4/11〜4/14 JSTのsnapshotをaction別に集計
  const start = new Date('2026-04-10T15:00:00Z'); // 4/11 0:00 JST
  const end = new Date('2026-04-14T15:00:00Z');   // 4/15 0:00 JST

  const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: { executionTime: { gte: start, lt: end } },
    select: { executionTime: true, action: true, adId: true, adName: true, dailyBudget: true, newBudget: true, advertiserId: true },
  });

  console.log(`\n期間 2026-04-11〜04-14 JST のsnapshot: ${snaps.length}件\n`);

  // action別カウント
  const byAction = new Map<string, number>();
  for (const s of snaps) {
    byAction.set(s.action ?? 'null', (byAction.get(s.action ?? 'null') ?? 0) + 1);
  }
  console.log('=== action別件数 ===');
  for (const [a, c] of [...byAction.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${a.padEnd(20)}: ${c}`);
  }

  // INCREASEの日別件数
  const increases = snaps.filter((s) => s.action === 'INCREASE');
  console.log(`\n=== INCREASE ${increases.length}件 の日別内訳（JST） ===`);
  const byDay = new Map<string, number>();
  for (const s of increases) {
    const jst = new Date(s.executionTime.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    byDay.set(jst, (byDay.get(jst) ?? 0) + 1);
  }
  for (const [d, c] of [...byDay.entries()].sort()) console.log(`  ${d}: ${c}`);

  // 広告別INCREASE回数上位
  const byAd = new Map<string, { name: string; count: number; budgets: number[] }>();
  for (const s of increases) {
    const cur = byAd.get(s.adId) ?? { name: s.adName ?? '?', count: 0, budgets: [] };
    cur.count += 1;
    if (s.newBudget != null) cur.budgets.push(s.newBudget);
    byAd.set(s.adId, cur);
  }
  const sorted = [...byAd.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 15);
  console.log(`\n=== 広告別INCREASE回数（上位15件） ===`);
  for (const [adId, v] of sorted) {
    const maxB = v.budgets.length ? Math.max(...v.budgets) : 0;
    console.log(`  ${v.count}回 | maxBudget=¥${maxB.toLocaleString().padStart(7)} | ${v.name} (${adId})`);
  }

  // 無限増額チェック: 同一広告で同日に5回以上INCREASEがあるケース
  console.log(`\n=== 同日5回以上INCREASEの広告（無限増額の再発チェック） ===`);
  type Key = string; // adId:day
  const byAdDay = new Map<Key, { name: string; count: number; budgets: number[]; times: Date[] }>();
  for (const s of increases) {
    const jst = new Date(s.executionTime.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const k = `${s.adId}:${jst}`;
    const cur = byAdDay.get(k) ?? { name: s.adName ?? '?', count: 0, budgets: [], times: [] };
    cur.count += 1;
    if (s.newBudget != null) cur.budgets.push(s.newBudget);
    cur.times.push(s.executionTime);
    byAdDay.set(k, cur);
  }
  const repeats = [...byAdDay.entries()].filter(([_, v]) => v.count >= 5).sort((a, b) => b[1].count - a[1].count);
  if (repeats.length === 0) {
    console.log('  なし（5回以上連続の増額は検出されず）');
  } else {
    for (const [k, v] of repeats) {
      const [adId, day] = k.split(':');
      const maxB = v.budgets.length ? Math.max(...v.budgets) : 0;
      console.log(`  ${day} | ${v.count}回 | maxBudget=¥${maxB.toLocaleString()} | ${v.name} (${adId})`);
    }
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
