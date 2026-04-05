import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()));
  const fourteenDaysAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Check entity types
  const entityTypes = await prisma.metric.groupBy({
    by: ['entityType'],
    _count: true,
  });
  console.log('Entity types:', entityTypes);

  // Check latest dates
  const latestMetric = await prisma.metric.findFirst({
    orderBy: { statDate: 'desc' },
    select: { statDate: true, entityType: true },
  });
  console.log('Latest metric date:', latestMetric);

  // Get metrics at AD level per advertiser
  const targetAccountIds = [
    '7468288053866561553', // AI_1
    '7523128243466551303', // AI_2
    '7543540647266074641', // AI_3
    '7580666710525493255', // AI_4
    '7474920444831875080', // スキルプラス1
    '7592868952431362066', // スキルプラス2
    '7247073333517238273', // SNS1
    '7543540100849156112', // SNS2
    '7543540381615800337', // SNS3
  ];

  const advertisers = await prisma.advertiser.findMany({
    where: { tiktokAdvertiserId: { in: targetAccountIds } },
    include: { appeal: true },
  });

  // Build ad -> advertiser mapping through campaign -> adgroup -> ad chain
  for (const adv of advertisers) {
    const campaigns = await prisma.campaign.findMany({
      where: { advertiserId: adv.id },
      select: { id: true },
    });
    if (campaigns.length === 0) continue;

    const adGroups = await prisma.adGroup.findMany({
      where: { campaignId: { in: campaigns.map(c => c.id) } },
      select: { id: true },
    });

    const ads = await prisma.ad.findMany({
      where: { adgroupId: { in: adGroups.map(ag => ag.id) } },
      select: { id: true },
    });
    const adIds = ads.map(a => a.id);

    if (adIds.length === 0) continue;

    // Get daily metrics
    const metrics = await prisma.metric.groupBy({
      by: ['statDate'],
      where: {
        entityType: 'AD',
        adId: { in: adIds },
        statDate: { gte: fourteenDaysAgo, lt: today },
      },
      _sum: {
        spend: true,
        impressions: true,
        clicks: true,
        conversions: true,
      },
      orderBy: { statDate: 'asc' },
    });

    if (metrics.length === 0) continue;

    console.log(`\n【${adv.name}】(${adv.tiktokAdvertiserId}) - 導線: ${adv.appeal?.name ?? 'N/A'}`);
    console.log(`  KPI: 目標CPA=¥${adv.appeal?.targetCPA ?? 'N/A'} | 許容CPA=¥${adv.appeal?.allowableCPA ?? 'N/A'}`);
    console.log('  日付    | 消化額      | imp       | CV  | CPA');
    console.log('  --------|------------|-----------|-----|--------');

    let total7dSpend = 0, total7dCV = 0;

    for (const m of metrics) {
      const date = new Date(m.statDate);
      const dateStr = `${(date.getUTCMonth()+1).toString().padStart(2)}/${date.getUTCDate().toString().padStart(2, '0')}`;
      const spend = m._sum.spend ?? 0;
      const cv = m._sum.conversions ?? 0;
      const imp = m._sum.impressions ?? 0;
      const cpa = cv > 0 ? Math.round(spend / cv) : 0;

      if (date >= sevenDaysAgo) {
        total7dSpend += spend;
        total7dCV += cv;
      }

      console.log(`  ${dateStr.padEnd(8)}| ¥${Math.round(spend).toLocaleString().padEnd(10)}| ${imp.toLocaleString().padEnd(9)}| ${cv.toString().padEnd(3)}| ${cv > 0 ? `¥${cpa.toLocaleString()}` : '-'}`);
    }

    const avg7dCPA = total7dCV > 0 ? Math.round(total7dSpend / total7dCV) : 0;
    console.log(`  -- 7日計: 消化¥${Math.round(total7dSpend).toLocaleString()} | CV:${total7dCV} | CPA:${total7dCV > 0 ? `¥${avg7dCPA.toLocaleString()}` : '-'} | 日平均CV:${(total7dCV/7).toFixed(1)}`);
  }

  // Overall daily totals
  console.log('\n\n=== 全対象アカウント合計 日次推移 ===');

  // Get all ad IDs for target accounts
  const allAdvs = await prisma.advertiser.findMany({
    where: { tiktokAdvertiserId: { in: targetAccountIds } },
    select: { id: true },
  });
  const allCampaigns = await prisma.campaign.findMany({
    where: { advertiserId: { in: allAdvs.map(a => a.id) } },
    select: { id: true },
  });
  const allAdGroups = await prisma.adGroup.findMany({
    where: { campaignId: { in: allCampaigns.map(c => c.id) } },
    select: { id: true },
  });
  const allAds = await prisma.ad.findMany({
    where: { adgroupId: { in: allAdGroups.map(ag => ag.id) } },
    select: { id: true },
  });
  const allAdIds = allAds.map(a => a.id);

  const allMetrics = await prisma.metric.groupBy({
    by: ['statDate'],
    where: {
      entityType: 'AD',
      adId: { in: allAdIds },
      statDate: { gte: fourteenDaysAgo, lt: today },
    },
    _sum: { spend: true, conversions: true, impressions: true },
    orderBy: { statDate: 'asc' },
  });

  let grandTotalCV = 0, grandTotalSpend = 0;
  for (const m of allMetrics) {
    const date = new Date(m.statDate);
    const dateStr = `${(date.getUTCMonth()+1)}/${date.getUTCDate()}`;
    const spend = m._sum.spend ?? 0;
    const cv = m._sum.conversions ?? 0;
    grandTotalCV += cv;
    grandTotalSpend += spend;
    console.log(`  ${dateStr}: CV=${cv} | 消化=¥${Math.round(spend).toLocaleString()} | CPA=${cv > 0 ? `¥${Math.round(spend/cv).toLocaleString()}` : '-'}`);
  }
  console.log(`  14日平均: ${(grandTotalCV/14).toFixed(1)} CV/日 | ¥${Math.round(grandTotalSpend/14).toLocaleString()}/日`);

  // Top ads last 7 days
  console.log('\n\n=== 7日間 Top20広告（CV多い順）===');
  const topAds = await prisma.metric.groupBy({
    by: ['adId'],
    where: {
      entityType: 'AD',
      statDate: { gte: sevenDaysAgo, lt: today },
      adId: { in: allAdIds },
    },
    _sum: { spend: true, conversions: true, impressions: true },
    orderBy: { _sum: { conversions: 'desc' } },
    take: 20,
  });

  for (const m of topAds) {
    if (!m.adId) continue;
    const ad = await prisma.ad.findUnique({
      where: { id: m.adId },
      include: { adgroup: { include: { campaign: { include: { advertiser: true } } } } },
    });
    if (!ad) continue;
    const spend = m._sum.spend ?? 0;
    const cv = m._sum.conversions ?? 0;
    const cpa = cv > 0 ? Math.round(spend / cv) : 0;
    console.log(`  ${ad.name} | ${ad.adgroup.campaign.advertiser.name} | CV:${cv} | ¥${Math.round(spend).toLocaleString()} | CPA:¥${cpa.toLocaleString()} | ${ad.status}`);
  }

  // Paused ads analysis - how many were paused by optimization in last 7 days
  console.log('\n\n=== 直近7日の停止広告数（最適化による）===');
  const changeLogs = await prisma.changeLog.groupBy({
    by: ['source'],
    where: {
      action: 'PAUSE',
      createdAt: { gte: sevenDaysAgo },
    },
    _count: true,
  });
  console.log(changeLogs);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
