import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const AI_ADVERTISERS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
];

const START_DATE = new Date('2025-09-01T00:00:00+09:00');
const END_DATE = new Date('2026-03-31T23:59:59.999+09:00');

function extractCreatorAndCR(adName: string): { creator: string; cr: string; lp: string } | null {
  const parts = adName.split('/');
  if (parts.length < 4) return null;
  return {
    creator: parts[1],
    cr: parts.slice(2, parts.length - 1).join('/'),
    lp: parts[parts.length - 1],
  };
}

async function main() {
  for (const adv of AI_ADVERTISERS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${adv.name} (${adv.id})`);
    console.log('='.repeat(60));

    const metrics = await prisma.metric.findMany({
      where: {
        entityType: 'AD',
        statDate: { gte: START_DATE, lte: END_DATE },
        ad: {
          adGroup: {
            campaign: {
              advertiser: { tiktokAdvertiserId: adv.id },
            },
          },
        },
      },
      include: {
        ad: { select: { tiktokId: true, name: true } },
      },
    });

    // 制作者別に集計
    const creatorStats = new Map<string, { spend: number; adCount: Set<string>; crs: Set<string> }>();
    // CR別に集計
    const crStats = new Map<string, { spend: number; adCount: Set<string>; creator: string }>();

    for (const m of metrics) {
      const adName = m.ad?.name || '';
      const parsed = extractCreatorAndCR(adName);
      if (!parsed) continue;

      const adId = m.ad?.tiktokId || '';

      // 制作者別
      if (!creatorStats.has(parsed.creator)) {
        creatorStats.set(parsed.creator, { spend: 0, adCount: new Set(), crs: new Set() });
      }
      const cs = creatorStats.get(parsed.creator)!;
      cs.spend += m.spend;
      cs.adCount.add(adId);
      cs.crs.add(parsed.cr);

      // CR別
      const crKey = `${parsed.creator}/${parsed.cr}`;
      if (!crStats.has(crKey)) {
        crStats.set(crKey, { spend: 0, adCount: new Set(), creator: parsed.creator });
      }
      const cr = crStats.get(crKey)!;
      cr.spend += m.spend;
      cr.adCount.add(adId);
    }

    const totalSpend = Array.from(creatorStats.values()).reduce((s, v) => s + v.spend, 0);

    // 制作者別TOP10
    console.log(`\n--- 制作者別 消化額TOP10（全体: ¥${totalSpend.toLocaleString('ja-JP', {maximumFractionDigits: 0})}) ---`);
    const sortedCreators = Array.from(creatorStats.entries())
      .sort((a, b) => b[1].spend - a[1].spend)
      .slice(0, 10);

    for (const [creator, stats] of sortedCreators) {
      const pct = ((stats.spend / totalSpend) * 100).toFixed(1);
      console.log(`  ${creator}: ¥${stats.spend.toLocaleString('ja-JP', {maximumFractionDigits: 0})} (${pct}%) / 広告${stats.adCount.size}本 / CR${stats.crs.size}種`);
    }

    // CR別TOP10
    console.log(`\n--- CR別 消化額TOP10 ---`);
    const sortedCRs = Array.from(crStats.entries())
      .sort((a, b) => b[1].spend - a[1].spend)
      .slice(0, 10);

    for (const [crKey, stats] of sortedCRs) {
      const pct = ((stats.spend / totalSpend) * 100).toFixed(1);
      console.log(`  ${crKey}: ¥${stats.spend.toLocaleString('ja-JP', {maximumFractionDigits: 0})} (${pct}%) / 広告${stats.adCount.size}本`);
    }

    // 消化額の集中度（上位CR何%が全体の何%を占めるか）
    const allCRSpends = Array.from(crStats.values()).map(v => v.spend).sort((a, b) => b - a);
    let cumulative = 0;
    let top50pctCount = 0;
    for (const spend of allCRSpends) {
      cumulative += spend;
      top50pctCount++;
      if (cumulative >= totalSpend * 0.5) break;
    }
    console.log(`\n  集中度: 上位${top50pctCount}CR（全${crStats.size}CR中）で消化額の50%を占有`);

    let cum80 = 0; let top80 = 0;
    for (const spend of allCRSpends) {
      cum80 += spend;
      top80++;
      if (cum80 >= totalSpend * 0.8) break;
    }
    console.log(`  集中度: 上位${top80}CR（全${crStats.size}CR中）で消化額の80%を占有`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
