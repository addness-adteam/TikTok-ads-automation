import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Get all appeals with their KPI targets
  const appeals = await prisma.appeal.findMany({
    include: { advertisers: true },
  });

  console.log('=== 訴求別KPI設定 ===');
  for (const appeal of appeals) {
    const accountNames = appeal.advertisers.map(a => `${a.name}(${a.tiktokAdvertiserId})`).join(', ');
    console.log(`\n【${appeal.name}】`);
    console.log(`  目標CPA: ${appeal.targetCPA ?? 'N/A'}`);
    console.log(`  許容CPA: ${appeal.allowableCPA ?? 'N/A'}`);
    console.log(`  目標フロントCPO: ${appeal.targetFrontCPO ?? 'N/A'}`);
    console.log(`  許容フロントCPO: ${appeal.allowableFrontCPO ?? 'N/A'}`);
    console.log(`  許容個別予約CPO: ${appeal.allowableIndividualReservationCPO ?? 'N/A'}`);
    console.log(`  アカウント: ${accountNames}`);
  }

  // 2. Get last 14 days metrics by account
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()));
  const fourteenDaysAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const advertisers = await prisma.advertiser.findMany({
    include: { appeal: true },
  });

  console.log('\n\n=== 直近14日間のアカウント別日次実績 ===');

  for (const adv of advertisers) {
    // Get campaign-level metrics for this advertiser
    const campaigns = await prisma.campaign.findMany({
      where: { advertiserId: adv.id },
      select: { id: true, tiktokId: true, name: true },
    });

    if (campaigns.length === 0) continue;

    const campaignIds = campaigns.map(c => c.id);

    // Get daily metrics aggregated
    const metrics = await prisma.metric.groupBy({
      by: ['statDate'],
      where: {
        entityType: 'CAMPAIGN',
        campaignId: { in: campaignIds },
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
    console.log('  日付         | 消化額    | imp      | clicks | CV  | CPA');
    console.log('  -------------|----------|----------|--------|-----|--------');

    let total7dSpend = 0, total7dCV = 0, total7dImp = 0;
    let total14dSpend = 0, total14dCV = 0, total14dImp = 0;

    for (const m of metrics) {
      const date = new Date(m.statDate);
      const dateStr = `${date.getUTCMonth()+1}/${date.getUTCDate()}`;
      const spend = m._sum.spend ?? 0;
      const cv = m._sum.conversions ?? 0;
      const imp = m._sum.impressions ?? 0;
      const clicks = m._sum.clicks ?? 0;
      const cpa = cv > 0 ? Math.round(spend / cv) : '-';

      total14dSpend += spend;
      total14dCV += cv;
      total14dImp += imp;

      if (date >= sevenDaysAgo) {
        total7dSpend += spend;
        total7dCV += cv;
        total7dImp += imp;
      }

      console.log(`  ${dateStr.padEnd(13)}| ¥${Math.round(spend).toLocaleString().padEnd(8)}| ${imp.toLocaleString().padEnd(8)}| ${clicks.toString().padEnd(6)}| ${cv.toString().padEnd(3)}| ${cpa === '-' ? '-' : `¥${cpa.toLocaleString()}`}`);
    }

    const avg7dCPA = total7dCV > 0 ? Math.round(total7dSpend / total7dCV) : '-';
    const avg7dDailyCV = Math.round(total7dCV / 7 * 10) / 10;
    const avg7dDailySpend = Math.round(total7dSpend / 7);

    console.log(`  ---- 7日集計 ----`);
    console.log(`  合計消化: ¥${Math.round(total7dSpend).toLocaleString()} | 合計CV: ${total7dCV} | 平均CPA: ${avg7dCPA === '-' ? '-' : `¥${avg7dCPA.toLocaleString()}`}`);
    console.log(`  1日平均CV: ${avg7dDailyCV} | 1日平均消化: ¥${avg7dDailySpend.toLocaleString()}`);
  }

  // 3. Count active ads per account
  console.log('\n\n=== アカウント別アクティブ広告数 ===');
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

    const activeAds = await prisma.ad.count({
      where: {
        adgroupId: { in: adGroups.map(ag => ag.id) },
        status: { in: ['ENABLE', 'ACTIVE'] },
      },
    });

    const totalAds = await prisma.ad.count({
      where: {
        adgroupId: { in: adGroups.map(ag => ag.id) },
      },
    });

    console.log(`  ${adv.name}: アクティブ ${activeAds} / 全体 ${totalAds}`);
  }

  // 4. Top performing ads (last 7 days)
  console.log('\n\n=== 7日間のトップ広告（CV多い順 Top20）===');
  const topAds = await prisma.metric.groupBy({
    by: ['adId'],
    where: {
      entityType: 'AD',
      statDate: { gte: sevenDaysAgo, lt: today },
      adId: { not: null },
    },
    _sum: {
      spend: true,
      conversions: true,
      impressions: true,
    },
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

    console.log(`  ${ad.name} | ${ad.adgroup.campaign.advertiser.name} | CV:${cv} | 消化:¥${Math.round(spend).toLocaleString()} | CPA:¥${cpa.toLocaleString()} | status:${ad.status}`);
  }

  // 5. Summary: total daily CVs across all accounts (last 7 days)
  console.log('\n\n=== 全アカウント合計 日次CV推移（直近14日）===');
  const allMetrics = await prisma.metric.groupBy({
    by: ['statDate'],
    where: {
      entityType: 'CAMPAIGN',
      statDate: { gte: fourteenDaysAgo, lt: today },
    },
    _sum: {
      spend: true,
      conversions: true,
      impressions: true,
    },
    orderBy: { statDate: 'asc' },
  });

  let totalCV = 0, totalSpend = 0;
  for (const m of allMetrics) {
    const date = new Date(m.statDate);
    const dateStr = `${date.getUTCMonth()+1}/${date.getUTCDate()}`;
    const spend = m._sum.spend ?? 0;
    const cv = m._sum.conversions ?? 0;
    totalCV += cv;
    totalSpend += spend;
    console.log(`  ${dateStr}: CV=${cv} | 消化=¥${Math.round(spend).toLocaleString()} | CPA=${cv > 0 ? `¥${Math.round(spend/cv).toLocaleString()}` : '-'}`);
  }
  console.log(`  合計: CV=${totalCV} | 消化=¥${Math.round(totalSpend).toLocaleString()}`);
  console.log(`  14日平均: ${Math.round(totalCV/14*10)/10} CV/日 | ¥${Math.round(totalSpend/14).toLocaleString()}/日`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
