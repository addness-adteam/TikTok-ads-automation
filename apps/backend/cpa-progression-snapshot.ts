/**
 * 増額ごとのCPA推移をsnapshot基準で追跡
 * - DB Metric欠落の影響を受けないよう、todaySpend/todayCVCount/todayCPA のみ使用
 * - 4/11〜4/14でINCREASE ≥3回の広告について、増額イベント周辺のCPA推移を出す
 */
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const start = new Date('2026-04-10T15:00:00Z');
  const end = new Date('2026-04-14T15:00:00Z');

  const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: { executionTime: { gte: start, lt: end } },
    orderBy: { executionTime: 'asc' },
    select: {
      executionTime: true, adId: true, adName: true, action: true,
      dailyBudget: true, newBudget: true, todaySpend: true, todayCVCount: true, todayCPA: true,
    },
  });

  // INCREASE回数で広告を絞り込み
  const incCount = new Map<string, number>();
  for (const s of snaps) if (s.action === 'INCREASE') incCount.set(s.adId, (incCount.get(s.adId) ?? 0) + 1);
  const targetAds = [...incCount.entries()].filter(([_, c]) => c >= 3).map(([id]) => id);

  console.log(`INCREASE≥3回の広告: ${targetAds.length}件\n`);

  // 各広告ごとにタイムライン出力
  for (const adId of targetAds) {
    const adSnaps = snaps.filter((s) => s.adId === adId);
    const name = adSnaps[0].adName;
    const totalInc = incCount.get(adId)!;
    console.log('='.repeat(120));
    console.log(`【${name}】 (${adId}) 総INCREASE=${totalInc}回`);
    console.log('-'.repeat(120));

    // 日別にグループ化
    const byDay = new Map<string, typeof adSnaps>();
    for (const s of adSnaps) {
      const jst = new Date(s.executionTime.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      if (!byDay.has(jst)) byDay.set(jst, []);
      byDay.get(jst)!.push(s);
    }

    for (const [day, daySnaps] of [...byDay.entries()].sort()) {
      const dayInc = daySnaps.filter((s) => s.action === 'INCREASE').length;
      if (dayInc === 0) continue; // INCREASEがない日はスキップ
      const endOfDay = daySnaps[daySnaps.length - 1];
      console.log(`  ◆ ${day} (当日INCREASE=${dayInc}回, 終値: dailyBudget=¥${endOfDay.dailyBudget}, spend=¥${endOfDay.todaySpend ?? 0}, CV=${endOfDay.todayCVCount ?? 0}, CPA=¥${endOfDay.todayCPA ?? '-'})`);
      console.log('  time   | action    | dailyBudget→new | todaySpend | todayCV | todayCPA');
      for (const s of daySnaps) {
        if (s.action !== 'INCREASE' && s.action !== 'CONTINUE') continue;
        const hhmm = new Date(s.executionTime.getTime() + 9 * 3600 * 1000).toISOString().slice(11, 16);
        const newB = s.newBudget != null ? `→¥${s.newBudget}` : '';
        console.log(`  ${hhmm}  | ${s.action?.padEnd(9)} | ¥${String(s.dailyBudget).padStart(6)}${newB.padEnd(10)} | ¥${String(s.todaySpend ?? 0).padStart(7)} | ${String(s.todayCVCount ?? 0).padStart(4)}    | ¥${s.todayCPA ?? '-'}`);
      }
    }
    console.log();
  }

  // サマリー: 増額回数ビン vs 当日終値CPA
  console.log('='.repeat(120));
  console.log('【サマリー】INCREASE回数ビン × 当日終値CPA（snapshot basis）');
  console.log('='.repeat(120));
  const bins = [
    { label: '1-2回', min: 1, max: 2, cpas: [] as number[], spend: 0, cv: 0, days: 0 },
    { label: '3-5回', min: 3, max: 5, cpas: [] as number[], spend: 0, cv: 0, days: 0 },
    { label: '6-10回', min: 6, max: 10, cpas: [] as number[], spend: 0, cv: 0, days: 0 },
    { label: '11+回', min: 11, max: Infinity, cpas: [] as number[], spend: 0, cv: 0, days: 0 },
  ];
  // 広告×日単位で {dayInc, endSpend, endCv}
  const adDayMap = new Map<string, { inc: number; spend: number; cv: number }>();
  for (const s of snaps) {
    const jst = new Date(s.executionTime.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const k = `${s.adId}:${jst}`;
    const cur = adDayMap.get(k) ?? { inc: 0, spend: 0, cv: 0 };
    if (s.action === 'INCREASE') cur.inc += 1;
    cur.spend = Math.max(cur.spend, s.todaySpend ?? 0);
    cur.cv = Math.max(cur.cv, s.todayCVCount ?? 0);
    adDayMap.set(k, cur);
  }
  for (const { inc, spend, cv } of adDayMap.values()) {
    if (inc === 0) continue;
    const bin = bins.find((b) => inc >= b.min && inc <= b.max);
    if (!bin) continue;
    bin.days += 1;
    bin.spend += spend;
    bin.cv += cv;
    if (cv > 0) bin.cpas.push(spend / cv);
  }
  console.log('bin    | 日数 | totalSpend | totalCV | 加重CPA | 中央値CPA | CV0日');
  for (const b of bins) {
    const weighted = b.cv > 0 ? Math.round(b.spend / b.cv) : 0;
    const sorted = [...b.cpas].sort((a, c) => a - c);
    const median = sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : 0;
    console.log(`${b.label.padEnd(6)} | ${String(b.days).padStart(4)} | ¥${Math.round(b.spend).toLocaleString().padStart(9)} | ${String(b.cv).padStart(7)} | ¥${weighted.toLocaleString().padStart(6)} | ¥${median.toLocaleString().padStart(8)} | ${b.days - b.cpas.length}`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
