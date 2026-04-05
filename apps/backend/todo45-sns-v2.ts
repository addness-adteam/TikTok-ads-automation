// TODO4&5: SNS1/SNS2/SNS3の状態調査 (v2 - ChangeLog修正版)
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()));
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const snsAccounts = [
    { name: 'SNS1', tiktokId: '7247073333517238273' },
    { name: 'SNS2', tiktokId: '7543540100849156112' },
    { name: 'SNS3 (参考)', tiktokId: '7543540381615800337' },
  ];

  for (const acc of snsAccounts) {
    console.log(`\n========== ${acc.name} (${acc.tiktokId}) ==========`);

    const adv = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: acc.tiktokId },
      include: { appeal: true },
    });
    if (!adv) { console.log('Not found'); continue; }

    // Check OAuth tokens
    const tokens = await prisma.oAuthToken.findMany({
      where: { advertiserId: acc.tiktokId },
      select: { id: true, accessToken: true, expiresAt: true, createdAt: true },
    });
    console.log(`\nOAuthトークン: ${tokens.length}件`);
    for (const t of tokens) {
      const expired = t.expiresAt ? t.expiresAt < new Date() : false;
      console.log(`  作成:${t.createdAt.toISOString()} | 期限:${t.expiresAt?.toISOString() ?? 'N/A'} | 期限切れ:${expired} | token:${t.accessToken.substring(0, 30)}...`);
    }

    // Check campaigns
    const campaigns = await prisma.campaign.findMany({
      where: { advertiserId: adv.id },
      select: { id: true, name: true, status: true },
    });
    const campaignStatusCount: Record<string, number> = {};
    for (const c of campaigns) {
      campaignStatusCount[c.status] = (campaignStatusCount[c.status] ?? 0) + 1;
    }
    console.log(`\nキャンペーン: ${campaigns.length}本 | ステータス:`, campaignStatusCount);

    // Check ads
    const adGroups = await prisma.adGroup.findMany({
      where: { campaignId: { in: campaigns.map(c => c.id) } },
      select: { id: true, status: true },
    });
    const ads = await prisma.ad.findMany({
      where: { adgroupId: { in: adGroups.map(ag => ag.id) } },
      select: { id: true, name: true, status: true, tiktokId: true },
    });
    const adStatusCount: Record<string, number> = {};
    for (const ad of ads) {
      adStatusCount[ad.status] = (adStatusCount[ad.status] ?? 0) + 1;
    }
    console.log(`広告: ${ads.length}本 | ステータス:`, adStatusCount);

    // Check recent metrics for active ads
    const activeAds = ads.filter(a => ['ENABLE', 'ACTIVE'].includes(a.status));
    if (activeAds.length > 0) {
      const adIds = activeAds.map(a => a.id);
      const metrics = await prisma.metric.groupBy({
        by: ['statDate'],
        where: { entityType: 'AD', adId: { in: adIds }, statDate: { gte: sevenDaysAgo, lt: today } },
        _sum: { spend: true, conversions: true, impressions: true },
        orderBy: { statDate: 'asc' },
      });
      console.log(`\n直近7日メトリクス:`);
      for (const m of metrics) {
        const date = new Date(m.statDate);
        console.log(`  ${date.getUTCMonth()+1}/${date.getUTCDate()}: 消化¥${Math.round(m._sum.spend ?? 0).toLocaleString()} | CV:${m._sum.conversions ?? 0} | imp:${(m._sum.impressions ?? 0).toLocaleString()}`);
      }

      // Top active ads by spend
      const adMetrics = await prisma.metric.groupBy({
        by: ['adId'],
        where: { entityType: 'AD', adId: { in: adIds }, statDate: { gte: sevenDaysAgo, lt: today } },
        _sum: { spend: true, conversions: true, impressions: true },
      });
      const adMetricMap = new Map(adMetrics.map(m => [m.adId!, m]));
      const adsWithMetrics = activeAds.map(ad => ({
        ...ad,
        spend: adMetricMap.get(ad.id)?._sum.spend ?? 0,
        cv: adMetricMap.get(ad.id)?._sum.conversions ?? 0,
        imp: adMetricMap.get(ad.id)?._sum.impressions ?? 0,
      })).filter(a => a.spend > 0).sort((a, b) => b.spend - a.spend);

      console.log(`\n消化のあるアクティブ広告 (Top10):`);
      for (const a of adsWithMetrics.slice(0, 10)) {
        const cpa = a.cv > 0 ? `¥${Math.round(a.spend / a.cv).toLocaleString()}` : '-';
        console.log(`  ${a.name} | CV:${a.cv} | 消化:¥${Math.round(a.spend).toLocaleString()} | CPA:${cpa}`);
      }
    }
  }

  // Check if shared access token exists
  console.log('\n\n========== 共通アクセストークン確認 ==========');
  const allTokens = await prisma.oAuthToken.findMany({
    select: { advertiserId: true, accessToken: true, expiresAt: true },
  });
  console.log(`全トークン数: ${allTokens.length}`);
  for (const t of allTokens) {
    const expired = t.expiresAt ? t.expiresAt < new Date() : false;
    console.log(`  advertiser:${t.advertiserId} | expired:${expired} | token:${t.accessToken.substring(0, 30)}...`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
