import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, 'apps/backend/.env') });
const prisma = new PrismaClient();
const NAMES: Record<string,string> = {'7468288053866561553':'AI_1','7523128243466551303':'AI_2','7543540647266074641':'AI_3','7580666710525493255':'AI_4','7247073333517238273':'SNS1','7543540100849156112':'SNS2','7543540381615800337':'SNS3','7474920444831875080':'SP1','7592868952431362066':'SP2','7616545514662051858':'SP3'};

async function getDBMetrics(adDbIds: string[]) {
  if (!adDbIds.length) return new Map<string, { spend: number; cv: number; imp: number; days: number }>();
  const cutoff = new Date(Date.now() - 8 * 86400000);
  const metrics = await prisma.metric.findMany({
    where: { adId: { in: adDbIds }, entityType: 'AD', statDate: { gte: cutoff } },
    select: { adId: true, statDate: true, spend: true, conversions: true, impressions: true }
  });
  const result = new Map<string, { spend: number; cv: number; imp: number; days: number }>();
  for (const m of metrics) {
    if (!m.adId) continue;
    const e = result.get(m.adId) || { spend: 0, cv: 0, imp: 0, days: 0 };
    e.spend += m.spend; e.cv += m.conversions; e.imp += m.impressions; e.days++;
    result.set(m.adId, e);
  }
  return result;
}

async function checkCR(pattern: string, label: string) {
  console.log(`\n── ${label} ──`);
  const ads = await prisma.ad.findMany({
    where: { name: { contains: pattern } },
    select: { id: true, tiktokId: true, name: true, status: true, adGroup: { select: { campaign: { select: { advertiser: { select: { tiktokAdvertiserId: true } } } } } } }
  });
  if (!ads.length) { console.log('  該当なし'); return; }
  const dbMetrics = await getDBMetrics(ads.map(a => a.id));
  for (const ad of ads) {
    const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId || '';
    const acc = NAMES[advId] || advId;
    const st = ad.status === 'ENABLE' ? '配信中' : ad.status === 'DISABLE' ? '停止' : ad.status || '';
    const m = dbMetrics.get(ad.id);
    console.log(`  ${acc} | ${st} | ${ad.name}`);
    if (m) {
      const cpa = m.cv > 0 ? m.spend / m.cv : 0;
      console.log(`    7日: 消化=¥${m.spend.toFixed(0)}, CV=${m.cv}, CPA=¥${cpa.toFixed(0)}, imp=${m.imp.toLocaleString()}, ${m.days}日分`);
    } else { console.log(`    メトリクスなし`); }
  }
}

async function checkAccount(advId: string, label: string) {
  console.log(`\n── ${label} ──`);
  const ads = await prisma.ad.findMany({
    where: { adGroup: { campaign: { advertiser: { tiktokAdvertiserId: advId } } } },
    select: { id: true, tiktokId: true, name: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' }, take: 40
  });
  const dbMetrics = await getDBMetrics(ads.map(a => a.id));
  let tSpend = 0, tCV = 0;
  for (const ad of ads) {
    const st = ad.status === 'ENABLE' ? '配信中' : '停止';
    const m = dbMetrics.get(ad.id);
    if (m && (m.spend > 0 || m.cv > 0)) {
      const cpa = m.cv > 0 ? m.spend / m.cv : 0;
      console.log(`  ${st} | ${ad.name}`);
      console.log(`    消化=¥${m.spend.toFixed(0)}, CV=${m.cv}, CPA=¥${cpa.toFixed(0)}, imp=${m.imp.toLocaleString()}`);
      tSpend += m.spend; tCV += m.cv;
    }
  }
  const noMetric = ads.filter(a => !dbMetrics.has(a.id) && a.status === 'ENABLE');
  if (noMetric.length > 0) {
    console.log(`  --- メトリクスなし(配信中) ${noMetric.length}本 ---`);
    for (const ad of noMetric.slice(0, 10)) console.log(`    ${ad.name}`);
    if (noMetric.length > 10) console.log(`    ...他${noMetric.length - 10}本`);
  }
  console.log(`  ── 合計: 消化=¥${tSpend.toFixed(0)}, CV=${tCV}, CPA=¥${tCV > 0 ? (tSpend/tCV).toFixed(0) : '-'}`);
}

async function main() {
  console.log('===== 効果測定レポート =====');
  await checkCR('CR00619', 'CR00619 (SNS再出稿済み)');
  await checkCR('CR01047', 'CR01047 (ClaudeCode解説)');
  await checkCR('CR00223', 'CR00223 (ClaudeCode解説LP2)');
  await checkCR('CR01074', 'CR01074 (2026年3月度勝ちCR)');
  console.log('\n\n===== 3/17横展開 初動確認 =====');
  await checkAccount('7543540647266074641', 'AI_3');
  await checkAccount('7580666710525493255', 'AI_4');
  await checkAccount('7543540100849156112', 'SNS2');
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
