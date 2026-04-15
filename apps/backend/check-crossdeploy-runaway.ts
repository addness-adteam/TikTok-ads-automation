import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  // 4/4横展開の15広告 LPコード
  const lpcrs = [
    'LP1-CR01146','LP1-CR01147','LP1-CR01148','LP1-CR01149','LP1-CR01150',
    'LP1-CR01151','LP1-CR01152','LP1-CR01153','LP1-CR01154',
    'LP1-CR01155','LP1-CR01156','LP1-CR01157','LP1-CR01158','LP1-CR01159','LP1-CR01160',
  ];
  const ads = await prisma.ad.findMany({
    where: { OR: lpcrs.map((c) => ({ name: { contains: c } })) },
    select: { id: true, tiktokId: true, name: true },
  });
  console.log(`対象広告: ${ads.length}件`);

  // 4/4-4/14の全snapshot
  const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      adId: { in: ads.map((a) => a.tiktokId) },
      executionTime: { gte: new Date('2026-04-03T15:00:00Z'), lt: new Date('2026-04-14T15:00:00Z') },
    },
    select: { adId: true, executionTime: true, action: true, dailyBudget: true, newBudget: true, todaySpend: true, todayCVCount: true },
  });

  // 広告×日ごとに INCREASE 回数, maxBudget, spend
  type Key = string;
  const byAdDay = new Map<Key, { inc: number; maxB: number; spend: number; cv: number }>();
  for (const s of snaps) {
    const day = new Date(s.executionTime.getTime() + 9*3600*1000).toISOString().slice(0,10);
    const k = `${s.adId}:${day}`;
    const cur = byAdDay.get(k) ?? { inc: 0, maxB: 0, spend: 0, cv: 0 };
    if (s.action === 'INCREASE') cur.inc += 1;
    cur.maxB = Math.max(cur.maxB, s.newBudget ?? s.dailyBudget ?? 0);
    cur.spend = Math.max(cur.spend, s.todaySpend ?? 0);
    cur.cv = Math.max(cur.cv, s.todayCVCount ?? 0);
    byAdDay.set(k, cur);
  }

  // 広告ごとにサマリー: 最大同日INC数, 最大maxBudget, 無限増額日数(INC≥5)
  type AdRow = { name: string; tiktok: string; maxDayInc: number; maxBudget: number; runawayDays: string[]; totalInc: number };
  const rows: AdRow[] = [];
  for (const ad of ads) {
    let maxDayInc = 0, maxBudget = 3000, totalInc = 0;
    const runaway: string[] = [];
    for (const [k, v] of byAdDay) {
      const [adId, day] = k.split(':');
      if (adId !== ad.tiktokId) continue;
      totalInc += v.inc;
      if (v.inc > maxDayInc) maxDayInc = v.inc;
      if (v.maxB > maxBudget) maxBudget = v.maxB;
      if (v.inc >= 5) runaway.push(`${day}(${v.inc}回→¥${v.maxB.toLocaleString()})`);
    }
    rows.push({ name: ad.name, tiktok: ad.tiktokId, maxDayInc, maxBudget, runawayDays: runaway, totalInc });
  }

  rows.sort((a,b) => b.maxBudget - a.maxBudget);
  console.log('\n=== 4/4横展開広告の無限増額被害状況 ===');
  console.log('name                                      | 総INC | 最大同日INC | 最大予算      | 無限増額日(INC≥5)');
  for (const r of rows) {
    const runawayStr = r.runawayDays.length ? r.runawayDays.join(', ') : '-';
    console.log(`${r.name.padEnd(42)} | ${String(r.totalInc).padStart(4)} | ${String(r.maxDayInc).padStart(8)} | ¥${r.maxBudget.toLocaleString().padStart(10)} | ${runawayStr}`);
  }

  // 判定サマリー
  const runawayCount = rows.filter(r => r.runawayDays.length > 0).length;
  const someIncCount = rows.filter(r => r.totalInc >= 1 && r.runawayDays.length === 0).length;
  const neverIncCount = rows.filter(r => r.totalInc === 0).length;
  console.log(`\n=== 判定 ===`);
  console.log(`無限増額被害あり(同日INC≥5回): ${runawayCount}本 / ${rows.length}本`);
  console.log(`軽度増額のみ(INC<5回/日)   : ${someIncCount}本`);
  console.log(`増額一切なし               : ${neverIncCount}本`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
