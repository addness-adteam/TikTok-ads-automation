/**
 * AI導線 CR別 消化/CV/CPA一覧表（2026-04月次）
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

const AI_ACCOUNTS: Record<string, string> = {
  AI_1: '7468288053866561553',
  AI_2: '7523128243466551303',
  AI_3: '7543540647266074641',
  AI_4: '7580666710525493255',
};
const PERIOD_START = new Date('2026-04-01T00:00:00+09:00');
const PERIOD_END = new Date('2026-04-15T00:00:00+09:00');

function extractCR(adName: string): string | null {
  const parts = adName.split('/');
  if (parts.length < 4) return null;
  const cr = parts.slice(2, parts.length - 1).join('/');
  return cr || null;
}

async function main() {
  const advertisers = await prisma.advertiser.findMany({
    where: { tiktokAdvertiserId: { in: Object.values(AI_ACCOUNTS) } },
  });
  const advNameByInternal = new Map<string, string>();
  for (const [name, ttId] of Object.entries(AI_ACCOUNTS)) {
    const adv = advertisers.find((a) => a.tiktokAdvertiserId === ttId);
    if (adv) advNameByInternal.set(adv.id, name);
  }

  const ads = await prisma.ad.findMany({
    where: {
      adGroup: { campaign: { advertiserId: { in: advertisers.map((a) => a.id) } } },
    },
    include: { adGroup: { include: { campaign: true } } },
  });

  const adInfo = new Map<string, { cr: string | null; accountName: string; adName: string }>();
  for (const ad of ads) {
    adInfo.set(ad.id, {
      cr: extractCR(ad.name),
      accountName: advNameByInternal.get(ad.adGroup.campaign.advertiserId) ?? 'UNKNOWN',
      adName: ad.name,
    });
  }

  const metrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      adId: { in: ads.map((a) => a.id) },
      statDate: { gte: PERIOD_START, lt: PERIOD_END },
    },
  });

  // CR × account 集計
  type Row = { cr: string; account: string; spend: number; cv: number; impressions: number; ads: Set<string> };
  const agg = new Map<string, Row>();
  for (const m of metrics) {
    if (!m.adId) continue;
    const info = adInfo.get(m.adId);
    if (!info || !info.cr) continue;
    const key = `${info.cr}|||${info.accountName}`;
    const cur = agg.get(key) ?? { cr: info.cr, account: info.accountName, spend: 0, cv: 0, impressions: 0, ads: new Set() };
    cur.spend += m.spend;
    cur.cv += m.conversions;
    cur.impressions += m.impressions;
    cur.ads.add(m.adId);
    agg.set(key, cur);
  }

  const rows = [...agg.values()].filter((r) => r.spend >= 100).map((r) => ({
    cr: r.cr,
    account: r.account,
    ads: r.ads.size,
    spend: Math.round(r.spend),
    cv: r.cv,
    cpa: r.cv > 0 ? Math.round(r.spend / r.cv) : null,
    impressions: r.impressions,
  }));

  // CR全体集計
  const crTotalMap = new Map<string, { spend: number; cv: number; ads: number; accounts: Set<string> }>();
  for (const r of rows) {
    const cur = crTotalMap.get(r.cr) ?? { spend: 0, cv: 0, ads: 0, accounts: new Set() };
    cur.spend += r.spend;
    cur.cv += r.cv;
    cur.ads += r.ads;
    cur.accounts.add(r.account);
    crTotalMap.set(r.cr, cur);
  }
  const crTotals = [...crTotalMap.entries()].map(([cr, v]) => ({
    cr,
    accounts: v.accounts.size,
    accountList: [...v.accounts].sort().join(','),
    ads: v.ads,
    spend: Math.round(v.spend),
    cv: v.cv,
    cpa: v.cv > 0 ? Math.round(v.spend / v.cv) : null,
  })).sort((a, b) => b.spend - a.spend);

  // 出力1: CR×アカウント詳細（CSV）
  const csvLines = ['CR,account,ads,spend,CV,CPA,impressions'];
  for (const r of rows.sort((a, b) => b.spend - a.spend)) {
    csvLines.push(`"${r.cr}",${r.account},${r.ads},${r.spend},${r.cv},${r.cpa ?? ''},${r.impressions}`);
  }
  fs.writeFileSync('apps/backend/ai-cpa-by-cr-account.csv', csvLines.join('\n'), 'utf8');

  // 出力2: CR合計（CSV）
  const csvLines2 = ['CR,accounts,accountList,ads,spend,CV,CPA'];
  for (const r of crTotals) {
    csvLines2.push(`"${r.cr}",${r.accounts},"${r.accountList}",${r.ads},${r.spend},${r.cv},${r.cpa ?? ''}`);
  }
  fs.writeFileSync('apps/backend/ai-cpa-by-cr-total.csv', csvLines2.join('\n'), 'utf8');

  // コンソール出力: CR合計表
  console.log('='.repeat(110));
  console.log('【CR別サマリ（AI全体合計、消化額降順）】');
  console.log('='.repeat(110));
  console.log('CR                                        | アカ | Ad数 | 消化        | CV   | CPA');
  console.log('-'.repeat(110));
  for (const r of crTotals) {
    const crLabel = r.cr.padEnd(40).substring(0, 40);
    const cpaStr = r.cpa !== null ? `¥${r.cpa.toLocaleString()}` : '---';
    console.log(`${crLabel} | ${String(r.accounts).padStart(2)}(${r.accountList.padEnd(19).substring(0,19)}) | ${String(r.ads).padStart(3)} | ¥${r.spend.toLocaleString().padStart(10)} | ${String(r.cv).padStart(4)} | ${cpaStr.padStart(8)}`);
  }

  console.log('\n' + '='.repeat(110));
  console.log('【CR×アカウント詳細（消化降順）】');
  console.log('='.repeat(110));
  console.log('CR                                        | acct | Ad | 消化        | CV   | CPA');
  console.log('-'.repeat(110));
  for (const r of rows.sort((a, b) => b.spend - a.spend)) {
    const crLabel = r.cr.padEnd(40).substring(0, 40);
    const cpaStr = r.cpa !== null ? `¥${r.cpa.toLocaleString()}` : '---';
    console.log(`${crLabel} | ${r.account.padEnd(4)} | ${String(r.ads).padStart(2)} | ¥${r.spend.toLocaleString().padStart(10)} | ${String(r.cv).padStart(4)} | ${cpaStr.padStart(8)}`);
  }

  console.log('\nCSV出力:');
  console.log('  apps/backend/ai-cpa-by-cr-total.csv');
  console.log('  apps/backend/ai-cpa-by-cr-account.csv');

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
