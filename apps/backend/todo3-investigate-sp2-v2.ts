// TODO3: スキルプラス2の急減速原因調査 (v2)
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()));
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);

  const adv = await prisma.advertiser.findUnique({
    where: { tiktokAdvertiserId: '7592868952431362066' },
  });
  if (!adv) { console.log('SP2 not found'); return; }

  const campaigns = await prisma.campaign.findMany({ where: { advertiserId: adv.id }, select: { id: true, name: true, status: true } });
  const adGroups = await prisma.adGroup.findMany({
    where: { campaignId: { in: campaigns.map(c => c.id) } },
    select: { id: true, name: true, budget: true, status: true },
  });
  const ads = await prisma.ad.findMany({
    where: { adgroupId: { in: adGroups.map(ag => ag.id) } },
    select: { id: true, tiktokId: true, name: true, status: true, adgroupId: true },
  });

  console.log(`=== スキルプラス2 広告状態 ===`);
  console.log(`キャンペーン: ${campaigns.length}本`);
  console.log(`広告グループ: ${adGroups.length}本`);
  console.log(`全広告: ${ads.length}本`);

  const statusCount: Record<string, number> = {};
  for (const ad of ads) {
    statusCount[ad.status] = (statusCount[ad.status] ?? 0) + 1;
  }
  console.log('ステータス別:', statusCount);

  // 1. Check pause logs using entityId (tiktokId of ads)
  const adTiktokIds = ads.map(a => a.tiktokId);
  const pauseLogs = await prisma.changeLog.findMany({
    where: {
      action: 'PAUSE',
      entityId: { in: adTiktokIds },
      createdAt: { gte: fourteenDaysAgo },
    },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`\n=== 直近14日の停止ログ: ${pauseLogs.length}件 ===`);
  for (const log of pauseLogs) {
    const ad = ads.find(a => a.tiktokId === log.entityId);
    console.log(`  ${log.createdAt.toISOString()} | ${log.source} | ${ad?.name ?? log.entityId} | ${log.reason ?? ''}`);
  }

  // 2. Active ads with metrics
  const activeAds = ads.filter(a => ['ENABLE', 'ACTIVE'].includes(a.status));
  console.log(`\nアクティブ広告: ${activeAds.length}本`);

  if (activeAds.length > 0) {
    const activeAdIds = activeAds.map(a => a.id);
    const adMetrics = await prisma.metric.groupBy({
      by: ['adId'],
      where: { entityType: 'AD', adId: { in: activeAdIds }, statDate: { gte: sevenDaysAgo, lt: today } },
      _sum: { spend: true, conversions: true, impressions: true },
    });

    const metricMap = new Map(adMetrics.map(m => [m.adId!, m]));
    const activeWithMetrics = activeAds.map(ad => {
      const m = metricMap.get(ad.id);
      const ag = adGroups.find(ag => ag.id === ad.adgroupId);
      return {
        ...ad,
        spend: m?._sum.spend ?? 0,
        cv: m?._sum.conversions ?? 0,
        imp: m?._sum.impressions ?? 0,
        budget: ag?.budget,
      };
    }).sort((a, b) => b.cv - a.cv);

    console.log(`\n=== アクティブ広告の7日実績 ===`);
    for (const a of activeWithMetrics) {
      const cpa = a.cv > 0 ? `¥${Math.round(a.spend / a.cv).toLocaleString()}` : '-';
      console.log(`  ${a.name} | CV:${a.cv} | 消化:¥${Math.round(a.spend).toLocaleString()} | CPA:${cpa} | 予算:¥${a.budget?.toLocaleString() ?? 'N/A'} | imp:${a.imp.toLocaleString()}`);
    }
  }

  // 3. Check DISABLED ads that were recently active (had metrics in last 14 days)
  const disabledAds = ads.filter(a => !['ENABLE', 'ACTIVE'].includes(a.status));
  if (disabledAds.length > 0) {
    const disabledAdIds = disabledAds.map(a => a.id);
    const disabledMetrics = await prisma.metric.groupBy({
      by: ['adId'],
      where: { entityType: 'AD', adId: { in: disabledAdIds }, statDate: { gte: fourteenDaysAgo, lt: today } },
      _sum: { spend: true, conversions: true, impressions: true },
    });

    const recentlyDisabled = disabledMetrics
      .filter(m => (m._sum.spend ?? 0) > 0)
      .sort((a, b) => (b._sum.conversions ?? 0) - (a._sum.conversions ?? 0));

    console.log(`\n=== 最近停止された広告（14日内に消化あり）: ${recentlyDisabled.length}本 ===`);
    for (const m of recentlyDisabled.slice(0, 20)) {
      const ad = disabledAds.find(a => a.id === m.adId);
      const cv = m._sum.conversions ?? 0;
      const spend = m._sum.spend ?? 0;
      const cpa = cv > 0 ? `¥${Math.round(spend / cv).toLocaleString()}` : '-';
      console.log(`  ${ad?.name ?? 'unknown'} | CV:${cv} | 消化:¥${Math.round(spend).toLocaleString()} | CPA:${cpa} | tiktokId:${ad?.tiktokId}`);
    }
  }

  // 4. Budget caps
  const budgetCaps = await prisma.adBudgetCap.findMany({
    where: { advertiserId: adv.id, enabled: true },
  });
  console.log(`\n=== 予算キャップ: ${budgetCaps.length}件 ===`);
  for (const cap of budgetCaps) {
    const ad = ads.find(a => a.id === cap.adId);
    console.log(`  ${ad?.name ?? cap.adId} | 上限:¥${cap.maxDailyBudget.toLocaleString()}`);
  }

  // 5. Exclusions
  const exclusions = await prisma.budgetOptimizationExclusion.findMany({
    where: { OR: [{ advertiserId: adv.id }, { advertiserId: null }] },
  });
  console.log(`\n=== 予算最適化除外: ${exclusions.length}件 ===`);
  for (const ex of exclusions) {
    console.log(`  CR名:${ex.creativeName} | scope:${ex.advertiserId ?? 'global'}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
