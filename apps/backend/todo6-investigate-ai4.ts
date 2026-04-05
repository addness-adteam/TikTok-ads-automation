// TODO6: AI_4の状態確認 + AI_1/AI_2の勝ちCRパターン抽出
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()));
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  // AI_4 status
  console.log('========== AI_4 状態確認 ==========');
  const ai4 = await prisma.advertiser.findUnique({
    where: { tiktokAdvertiserId: '7580666710525493255' },
    include: { appeal: true },
  });
  if (!ai4) { console.log('AI_4 not found'); return; }

  const tokens = await prisma.oAuthToken.findMany({
    where: { advertiserId: ai4.id },
    select: { accessToken: true, expiresAt: true },
  });
  console.log(`OAuthトークン: ${tokens.length}件`);
  for (const t of tokens) {
    console.log(`  期限:${t.expiresAt?.toISOString()} | 切れ:${t.expiresAt ? t.expiresAt < new Date() : 'N/A'}`);
  }

  const campaigns = await prisma.campaign.findMany({
    where: { advertiserId: ai4.id },
    select: { id: true, name: true, status: true, objectiveType: true },
  });
  console.log(`\nキャンペーン: ${campaigns.length}本`);
  for (const c of campaigns) {
    console.log(`  ${c.name} | ${c.status} | ${c.objectiveType}`);
  }

  const adGroups = await prisma.adGroup.findMany({
    where: { campaignId: { in: campaigns.map(c => c.id) } },
    select: { id: true, name: true, status: true, budget: true },
  });
  console.log(`\n広告グループ: ${adGroups.length}本`);
  for (const ag of adGroups) {
    console.log(`  ${ag.name} | ${ag.status} | 予算:¥${ag.budget?.toLocaleString() ?? 'N/A'}`);
  }

  const ads = await prisma.ad.findMany({
    where: { adgroupId: { in: adGroups.map(ag => ag.id) } },
    select: { id: true, name: true, status: true, tiktokId: true },
  });
  console.log(`\n広告: ${ads.length}本`);
  for (const ad of ads) {
    console.log(`  ${ad.name} | ${ad.status} | tiktokId:${ad.tiktokId}`);
  }

  // AI_1 & AI_2 winning CR patterns
  console.log('\n\n========== AI_1 & AI_2 勝ちCRパターン抽出 ==========');
  const aiAccounts = [
    { name: 'AI_1', tiktokId: '7468288053866561553' },
    { name: 'AI_2', tiktokId: '7523128243466551303' },
  ];

  const allWinningCRs = new Map<string, { totalCV: number; totalSpend: number; accounts: Set<string> }>();

  for (const acc of aiAccounts) {
    const adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: acc.tiktokId } });
    if (!adv) continue;

    const cmpgns = await prisma.campaign.findMany({ where: { advertiserId: adv.id }, select: { id: true } });
    const ags = await prisma.adGroup.findMany({ where: { campaignId: { in: cmpgns.map(c => c.id) } }, select: { id: true } });
    const advAds = await prisma.ad.findMany({
      where: { adgroupId: { in: ags.map(ag => ag.id) } },
      select: { id: true, name: true, status: true },
    });

    const adIds = advAds.map(a => a.id);
    const metrics = await prisma.metric.groupBy({
      by: ['adId'],
      where: { entityType: 'AD', adId: { in: adIds }, statDate: { gte: sevenDaysAgo, lt: today } },
      _sum: { spend: true, conversions: true },
    });

    const metricMap = new Map(metrics.map(m => [m.adId!, m]));

    // Group by CR name
    for (const ad of advAds) {
      const m = metricMap.get(ad.id);
      const cv = m?._sum.conversions ?? 0;
      const spend = m?._sum.spend ?? 0;
      if (cv === 0) continue;

      const parts = ad.name.split('/');
      if (parts.length >= 3) {
        const crName = parts[2];
        const existing = allWinningCRs.get(crName) ?? { totalCV: 0, totalSpend: 0, accounts: new Set<string>() };
        existing.totalCV += cv;
        existing.totalSpend += spend;
        existing.accounts.add(acc.name);
        allWinningCRs.set(crName, existing);
      }
    }
  }

  console.log('\n勝ちCR Top30（AI_1 + AI_2、CV多い順）:');
  const sortedCRs = [...allWinningCRs.entries()]
    .sort((a, b) => b[1].totalCV - a[1].totalCV);
  for (const [cr, data] of sortedCRs.slice(0, 30)) {
    const cpa = Math.round(data.totalSpend / data.totalCV);
    console.log(`  ${cr} | CV:${data.totalCV} | CPA:¥${cpa.toLocaleString()} | アカウント:${[...data.accounts].join(',')}`);
  }

  // Also extract LP patterns
  console.log('\n\n勝ちLPパターン:');
  const lpPatterns = new Map<string, { totalCV: number; totalSpend: number }>();
  for (const acc of aiAccounts) {
    const adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: acc.tiktokId } });
    if (!adv) continue;
    const cmpgns = await prisma.campaign.findMany({ where: { advertiserId: adv.id }, select: { id: true } });
    const ags = await prisma.adGroup.findMany({ where: { campaignId: { in: cmpgns.map(c => c.id) } }, select: { id: true } });
    const advAds = await prisma.ad.findMany({
      where: { adgroupId: { in: ags.map(ag => ag.id) } },
      select: { id: true, name: true },
    });
    const adIds = advAds.map(a => a.id);
    const metrics = await prisma.metric.groupBy({
      by: ['adId'],
      where: { entityType: 'AD', adId: { in: adIds }, statDate: { gte: sevenDaysAgo, lt: today } },
      _sum: { spend: true, conversions: true },
    });
    const metricMap = new Map(metrics.map(m => [m.adId!, m]));

    for (const ad of advAds) {
      const m = metricMap.get(ad.id);
      const cv = m?._sum.conversions ?? 0;
      const spend = m?._sum.spend ?? 0;
      if (cv === 0) continue;
      const parts = ad.name.split('/');
      if (parts.length >= 4) {
        const lpName = parts[3];
        const existing = lpPatterns.get(lpName) ?? { totalCV: 0, totalSpend: 0 };
        existing.totalCV += cv;
        existing.totalSpend += spend;
        lpPatterns.set(lpName, existing);
      }
    }
  }

  const sortedLPs = [...lpPatterns.entries()].sort((a, b) => b[1].totalCV - a[1].totalCV);
  for (const [lp, data] of sortedLPs.slice(0, 15)) {
    console.log(`  ${lp} | CV:${data.totalCV} | CPA:¥${Math.round(data.totalSpend / data.totalCV).toLocaleString()}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
