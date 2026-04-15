/**
 * ゾンビMetric検知: 同一Adの連続日で (spend, impressions, conversions) が完全一致する行を洗い出す
 * （Smart+ 7日ローリング合計バグの影響範囲可視化）
 */
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const AI_ACCOUNTS: Record<string, string> = {
  AI_1: '7468288053866561553',
  AI_2: '7523128243466551303',
  AI_3: '7543540647266074641',
  AI_4: '7580666710525493255',
};
const PERIOD_START = new Date('2026-03-25T00:00:00Z');
const PERIOD_END = new Date('2026-04-15T00:00:00Z');

async function main() {
  const prisma = new PrismaClient();
  const advertisers = await prisma.advertiser.findMany({
    where: { tiktokAdvertiserId: { in: Object.values(AI_ACCOUNTS) } },
  });
  const advNameByInternal = new Map<string, string>();
  for (const [name, ttId] of Object.entries(AI_ACCOUNTS)) {
    const a = advertisers.find((x) => x.tiktokAdvertiserId === ttId);
    if (a) advNameByInternal.set(a.id, name);
  }

  const ads = await prisma.ad.findMany({
    where: { adGroup: { campaign: { advertiserId: { in: advertisers.map((a) => a.id) } } } },
    include: { adGroup: { include: { campaign: true } } },
  });

  const metrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      adId: { in: ads.map((a) => a.id) },
      statDate: { gte: PERIOD_START, lt: PERIOD_END },
    },
    orderBy: [{ adId: 'asc' }, { statDate: 'asc' }],
  });

  // ad毎にstatDate順で並べ、(spend,imp,cv)の連続重複を検出
  const byAd = new Map<string, typeof metrics>();
  for (const m of metrics) {
    if (!m.adId) continue;
    if (!byAd.has(m.adId)) byAd.set(m.adId, []);
    byAd.get(m.adId)!.push(m);
  }

  type Zombie = {
    account: string; adName: string; tiktokId: string; startDate: string; endDate: string;
    daysDuplicated: number; spend: number; cv: number; imp: number; totalPhantomSpend: number;
  };
  const zombies: Zombie[] = [];
  const adById = new Map(ads.map((a) => [a.id, a]));

  for (const [adId, rows] of byAd) {
    if (rows.length < 2) continue;
    const ad = adById.get(adId);
    if (!ad) continue;
    const acct = advNameByInternal.get(ad.adGroup.campaign.advertiserId) ?? '?';

    // 連続重複ラン検出
    let i = 0;
    while (i < rows.length) {
      const base = rows[i];
      if (base.spend < 1) { i++; continue; }
      let j = i + 1;
      while (j < rows.length &&
             Math.abs(rows[j].spend - base.spend) < 1 &&
             rows[j].impressions === base.impressions &&
             rows[j].conversions === base.conversions) {
        j++;
      }
      const runLen = j - i;
      if (runLen >= 2) {
        const totalPhantom = base.spend * (runLen - 1); // 1日分は本物と仮定、残りは水増し
        zombies.push({
          account: acct,
          adName: ad.name,
          tiktokId: ad.tiktokId,
          startDate: rows[i].statDate.toISOString().substring(0, 10),
          endDate: rows[j - 1].statDate.toISOString().substring(0, 10),
          daysDuplicated: runLen,
          spend: base.spend,
          cv: base.conversions,
          imp: base.impressions,
          totalPhantomSpend: totalPhantom,
        });
      }
      i = j;
    }
  }

  zombies.sort((a, b) => b.totalPhantomSpend - a.totalPhantomSpend);

  console.log('='.repeat(120));
  console.log(`ゾンビMetric検知結果 (期間: ${PERIOD_START.toISOString().substring(0,10)} 〜 ${PERIOD_END.toISOString().substring(0,10)})`);
  console.log('='.repeat(120));
  console.log(`検知広告数: ${zombies.length}`);
  const totalPhantom = zombies.reduce((s, z) => s + z.totalPhantomSpend, 0);
  console.log(`水増しspend合計(推定): ¥${totalPhantom.toLocaleString()}`);
  console.log('');
  console.log('acct | 期間            | 日数 | 同値spend | cv | 水増し総額    | 広告名');
  console.log('-'.repeat(120));
  for (const z of zombies.slice(0, 60)) {
    console.log(`${z.account} | ${z.startDate}〜${z.endDate} | ${z.daysDuplicated}日 | ¥${Math.round(z.spend).toLocaleString().padStart(8)} | ${String(z.cv).padStart(3)} | ¥${Math.round(z.totalPhantomSpend).toLocaleString().padStart(9)} | ${z.adName.substring(0, 50)}`);
  }

  // CSV
  const csv = ['account,startDate,endDate,daysDuplicated,spendPerRow,cv,impressions,phantomSpendTotal,adName,tiktokId'];
  for (const z of zombies) {
    csv.push(`${z.account},${z.startDate},${z.endDate},${z.daysDuplicated},${Math.round(z.spend)},${z.cv},${z.imp},${Math.round(z.totalPhantomSpend)},"${z.adName}",${z.tiktokId}`);
  }
  fs.writeFileSync(path.join(process.cwd(), 'zombie-metrics.csv'), csv.join('\n'), 'utf8');
  console.log(`\nCSV: ${path.join(process.cwd(), 'zombie-metrics.csv')}`);

  // アカウント別サマリ
  console.log('\n■ アカウント別 水増し推定額');
  const byAcct = new Map<string, number>();
  for (const z of zombies) byAcct.set(z.account, (byAcct.get(z.account) ?? 0) + z.totalPhantomSpend);
  for (const [a, v] of [...byAcct.entries()].sort((x,y)=>y[1]-x[1])) {
    console.log(`  ${a}: ¥${Math.round(v).toLocaleString()}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
