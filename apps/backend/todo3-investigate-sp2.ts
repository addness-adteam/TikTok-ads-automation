// TODO3: スキルプラス2の急減速原因調査
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

  // 1. Check recent pause logs
  console.log('=== スキルプラス2 直近14日の停止ログ ===');
  const changeLogs = await prisma.changeLog.findMany({
    where: {
      advertiserId: adv.id,
      action: 'PAUSE',
      createdAt: { gte: fourteenDaysAgo },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  console.log(`停止ログ数: ${changeLogs.length}`);
  for (const log of changeLogs.slice(0, 30)) {
    console.log(`  ${log.createdAt.toISOString()} | ${log.source} | ${log.adName ?? 'N/A'} | ${log.reason ?? ''}`);
  }

  // 2. Check active ads and their budgets
  const campaigns = await prisma.campaign.findMany({ where: { advertiserId: adv.id }, select: { id: true, name: true, status: true } });
  const adGroups = await prisma.adGroup.findMany({
    where: { campaignId: { in: campaigns.map(c => c.id) } },
    select: { id: true, name: true, budget: true, status: true },
  });
  const ads = await prisma.ad.findMany({
    where: { adgroupId: { in: adGroups.map(ag => ag.id) } },
    select: { id: true, tiktokId: true, name: true, status: true, adgroupId: true },
  });

  console.log(`\n=== スキルプラス2 広告状態 ===`);
  console.log(`キャンペーン: ${campaigns.length}本`);
  console.log(`広告グループ: ${adGroups.length}本`);
  console.log(`全広告: ${ads.length}本`);

  const statusCount: Record<string, number> = {};
  for (const ad of ads) {
    statusCount[ad.status] = (statusCount[ad.status] ?? 0) + 1;
  }
  console.log('ステータス別:', statusCount);

  // 3. Check active ads with metrics
  const activeAds = ads.filter(a => ['ENABLE', 'ACTIVE'].includes(a.status));
  console.log(`\nアクティブ広告: ${activeAds.length}本`);

  const activeAdIds = activeAds.map(a => a.id);
  if (activeAdIds.length > 0) {
    const adMetrics = await prisma.metric.groupBy({
      by: ['adId'],
      where: { entityType: 'AD', adId: { in: activeAdIds }, statDate: { gte: sevenDaysAgo, lt: today } },
      _sum: { spend: true, conversions: true, impressions: true },
    });

    console.log(`\n=== アクティブ広告の7日実績 ===`);
    const metricMap = new Map(adMetrics.map(m => [m.adId!, m]));
    const activeWithMetrics = activeAds.map(ad => {
      const m = metricMap.get(ad.id);
      return {
        ...ad,
        spend: m?._sum.spend ?? 0,
        cv: m?._sum.conversions ?? 0,
        imp: m?._sum.impressions ?? 0,
      };
    }).sort((a, b) => b.cv - a.cv);

    for (const a of activeWithMetrics) {
      const cpa = a.cv > 0 ? `¥${Math.round(a.spend / a.cv).toLocaleString()}` : '-';
      const ag = adGroups.find(ag => ag.id === a.adgroupId);
      console.log(`  ${a.name} | CV:${a.cv} | 消化:¥${Math.round(a.spend).toLocaleString()} | CPA:${cpa} | 予算:¥${ag?.budget?.toLocaleString() ?? 'N/A'} | ${a.status}`);
    }
  }

  // 4. Check budget caps
  console.log(`\n=== 予算キャップ ===`);
  const budgetCaps = await prisma.adBudgetCap.findMany({
    where: { advertiserId: adv.id, enabled: true },
  });
  console.log(`有効な予算キャップ: ${budgetCaps.length}件`);
  for (const cap of budgetCaps) {
    const ad = ads.find(a => a.id === cap.adId);
    console.log(`  ${ad?.name ?? cap.adId} | 上限:¥${cap.maxDailyBudget.toLocaleString()}`);
  }

  // 5. Check budget optimization exclusions
  const exclusions = await prisma.budgetOptimizationExclusion.findMany({
    where: { OR: [{ advertiserId: adv.id }, { advertiserId: null }] },
  });
  console.log(`\n=== 予算最適化除外 ===`);
  console.log(`除外設定: ${exclusions.length}件`);
  for (const ex of exclusions) {
    console.log(`  CR名:${ex.creativeName} | advertiser:${ex.advertiserId ?? 'global'} | 有効期限:${ex.expiresAt?.toISOString() ?? 'なし'}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
