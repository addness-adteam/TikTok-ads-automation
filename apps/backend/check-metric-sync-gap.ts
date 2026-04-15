import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  // snapshot上でtodaySpend>0 だった広告(4/11-4/14) と Metric行の照合
  const start = new Date('2026-04-10T15:00:00Z');
  const end = new Date('2026-04-14T15:00:00Z');

  // snapshotでspendがあった広告（日別）
  const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: { executionTime: { gte: start, lt: end } },
    select: { adId: true, adName: true, executionTime: true, todaySpend: true, todayCVCount: true },
  });

  // ad×日単位で最大todaySpendを集計
  type Key = string;
  const snapByAdDay = new Map<Key, { name: string; maxSpend: number; maxCv: number }>();
  for (const s of snaps) {
    const jst = new Date(s.executionTime.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const k = `${s.adId}:${jst}`;
    const cur = snapByAdDay.get(k) ?? { name: s.adName ?? '?', maxSpend: 0, maxCv: 0 };
    cur.maxSpend = Math.max(cur.maxSpend, s.todaySpend ?? 0);
    cur.maxCv = Math.max(cur.maxCv, s.todayCVCount ?? 0);
    snapByAdDay.set(k, cur);
  }

  // snapshotでspend>0のad×日のみ対象
  const targets = [...snapByAdDay.entries()].filter(([_, v]) => v.maxSpend > 0);
  console.log(`snapshotでspend>0の(ad,day)件数: ${targets.length}`);

  // 対応するMetric行があるか確認
  const adTiktokIds = [...new Set(targets.map(([k]) => k.split(':')[0]))];
  const ads = await prisma.ad.findMany({
    where: { tiktokId: { in: adTiktokIds } },
    select: { id: true, tiktokId: true, name: true },
  });
  const internalByTiktok = new Map(ads.map((a) => [a.tiktokId, a.id]));

  const metrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      adId: { in: ads.map((a) => a.id) },
      statDate: { gte: new Date('2026-04-11'), lt: new Date('2026-04-15') },
    },
    select: { adId: true, statDate: true, spend: true },
  });
  const metByAdDay = new Map<string, number>();
  for (const m of metrics) {
    const k = `${m.adId}:${m.statDate.toISOString().slice(0, 10)}`;
    metByAdDay.set(k, (metByAdDay.get(k) ?? 0) + m.spend);
  }

  let missing = 0;
  let present = 0;
  const missingList: { day: string; name: string; snapSpend: number; adTiktok: string }[] = [];
  for (const [key, v] of targets) {
    const [adTiktok, day] = key.split(':');
    const internalId = internalByTiktok.get(adTiktok);
    if (!internalId) { missing++; continue; }
    const mKey = `${internalId}:${day}`;
    if (metByAdDay.has(mKey)) present++;
    else { missing++; missingList.push({ day, name: v.name, snapSpend: v.maxSpend, adTiktok }); }
  }

  console.log(`\nMetric行あり: ${present}`);
  console.log(`Metric行なし: ${missing}`);
  console.log(`欠落率: ${(missing / (missing + present) * 100).toFixed(1)}%`);

  console.log(`\n=== Metric欠落している(ad,day)の上位30件（snapSpend降順） ===`);
  missingList.sort((a, b) => b.snapSpend - a.snapSpend);
  for (const m of missingList.slice(0, 30)) {
    console.log(`  ${m.day} | snapSpend=¥${m.snapSpend.toLocaleString().padStart(8)} | ${m.adTiktok} | ${m.name}`);
  }

  // Metric欠落してる広告について、AD系 Metric全般がないか、AD_GROUP系があるか確認
  console.log(`\n=== サンプル: CR01170 (1861681678881889) のMetric全データ ===`);
  const cr01170AdId = internalByTiktok.get('1861681678881889');
  if (cr01170AdId) {
    const all = await prisma.metric.findMany({
      where: { OR: [{ adId: cr01170AdId }] },
      orderBy: { statDate: 'desc' },
      take: 10,
    });
    console.log(`AD type Metric: ${all.length}件`);
    for (const m of all) console.log(`  ${m.statDate.toISOString().slice(0, 10)} | entityType=${m.entityType} | spend=¥${m.spend} | conv=${m.conversions}`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
