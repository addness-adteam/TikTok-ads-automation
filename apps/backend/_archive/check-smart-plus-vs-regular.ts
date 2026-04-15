// スマプラ vs 通常配信の成績比較 + SP1/SP2のCR重複確認
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()));
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  // ===== 1. AI導線: スマプラ vs 通常配信 =====
  console.log('============================================================');
  console.log('1. AI導線: スマプラ vs 通常配信の成績比較');
  console.log('============================================================');

  const aiAccounts = [
    { name: 'AI_1', tiktokId: '7468288053866561553' },
    { name: 'AI_2', tiktokId: '7523128243466551303' },
    { name: 'AI_3', tiktokId: '7543540647266074641' },
  ];

  for (const acc of aiAccounts) {
    const adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: acc.tiktokId } });
    if (!adv) continue;

    const campaigns = await prisma.campaign.findMany({
      where: { advertiserId: adv.id },
      select: { id: true, name: true },
    });
    const adGroups = await prisma.adGroup.findMany({
      where: { campaignId: { in: campaigns.map(c => c.id) } },
      select: { id: true, campaignId: true },
    });
    const ads = await prisma.ad.findMany({
      where: { adgroupId: { in: adGroups.map(ag => ag.id) } },
      select: { id: true, tiktokId: true, name: true, status: true, adgroupId: true },
    });

    // Determine smart plus vs regular by checking if tiktokId looks like a smart_plus_ad_id
    // Smart Plus ads typically have shorter IDs or were synced from smart_plus endpoint
    // Actually, let's check by campaign name pattern - Smart Plus campaigns often have "スマプラ" or "スマ" in name
    const campaignMap = new Map(campaigns.map(c => [c.id, c.name]));
    const agCampaignMap = new Map(adGroups.map(ag => [ag.id, ag.campaignId]));

    // Better approach: check ad name for "スマ" prefix in campaign part, or check campaign name
    const smartPlusAds: typeof ads = [];
    const regularAds: typeof ads = [];

    for (const ad of ads) {
      const campaignId = agCampaignMap.get(ad.adgroupId);
      const campaignName = campaignId ? campaignMap.get(campaignId) : '';
      // Smart Plus campaigns typically have "スマ" or "スマプラ" in name
      // Also check ad name for "スマ " prefix pattern
      const isSmartPlus = (campaignName?.includes('スマ') || ad.name.includes('/スマ ') || ad.name.includes('/スマプラ'));
      if (isSmartPlus) {
        smartPlusAds.push(ad);
      } else {
        regularAds.push(ad);
      }
    }

    // Get metrics for each group
    const getGroupMetrics = async (adList: typeof ads, period: Date) => {
      if (adList.length === 0) return { spend: 0, cv: 0, imp: 0, activeCount: 0, totalCount: adList.length };
      const adIds = adList.map(a => a.id);
      const metrics = await prisma.metric.groupBy({
        by: ['adId'],
        where: { entityType: 'AD', adId: { in: adIds }, statDate: { gte: period, lt: today } },
        _sum: { spend: true, conversions: true, impressions: true },
      });
      let totalSpend = 0, totalCV = 0, totalImp = 0;
      for (const m of metrics) {
        totalSpend += m._sum.spend ?? 0;
        totalCV += m._sum.conversions ?? 0;
        totalImp += m._sum.impressions ?? 0;
      }
      const activeCount = adList.filter(a => ['ENABLE', 'ACTIVE'].includes(a.status)).length;
      return { spend: totalSpend, cv: totalCV, imp: totalImp, activeCount, totalCount: adList.length };
    };

    const sp7d = await getGroupMetrics(smartPlusAds, sevenDaysAgo);
    const reg7d = await getGroupMetrics(regularAds, sevenDaysAgo);

    console.log(`\n【${acc.name}】`);
    console.log(`  スマプラ: ${sp7d.totalCount}本(Active:${sp7d.activeCount}) | 7日CV:${sp7d.cv} | 消化:¥${Math.round(sp7d.spend).toLocaleString()} | CPA:${sp7d.cv > 0 ? `¥${Math.round(sp7d.spend/sp7d.cv).toLocaleString()}` : '-'} | imp:${sp7d.imp.toLocaleString()}`);
    console.log(`  通常配信: ${reg7d.totalCount}本(Active:${reg7d.activeCount}) | 7日CV:${reg7d.cv} | 消化:¥${Math.round(reg7d.spend).toLocaleString()} | CPA:${reg7d.cv > 0 ? `¥${Math.round(reg7d.spend/reg7d.cv).toLocaleString()}` : '-'} | imp:${reg7d.imp.toLocaleString()}`);

    // Show top CRs from each type
    const showTopAds = async (adList: typeof ads, label: string) => {
      if (adList.length === 0) return;
      const adIds = adList.map(a => a.id);
      const metrics = await prisma.metric.groupBy({
        by: ['adId'],
        where: { entityType: 'AD', adId: { in: adIds }, statDate: { gte: sevenDaysAgo, lt: today } },
        _sum: { spend: true, conversions: true, impressions: true },
      });
      const sorted = metrics
        .filter(m => (m._sum.conversions ?? 0) > 0)
        .sort((a, b) => (b._sum.conversions ?? 0) - (a._sum.conversions ?? 0));

      console.log(`  ${label} Top5:`);
      for (const m of sorted.slice(0, 5)) {
        const ad = adList.find(a => a.id === m.adId);
        const cv = m._sum.conversions ?? 0;
        const spend = m._sum.spend ?? 0;
        console.log(`    ${ad?.name} | CV:${cv} | CPA:¥${Math.round(spend/cv).toLocaleString()} | ${ad?.status}`);
      }
    };

    await showTopAds(smartPlusAds, 'スマプラ');
    await showTopAds(regularAds, '通常配信');
  }

  // ===== 2. SP1 vs SP2: CR名の重複確認 =====
  console.log('\n\n============================================================');
  console.log('2. スキルプラス1 vs スキルプラス2: CR名重複確認');
  console.log('============================================================');

  const sp1Adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: '7474920444831875080' } });
  const sp2Adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: '7592868952431362066' } });

  if (sp1Adv && sp2Adv) {
    // SP2の勝ちCR名を取得
    const sp2Campaigns = await prisma.campaign.findMany({ where: { advertiserId: sp2Adv.id }, select: { id: true } });
    const sp2AdGroups = await prisma.adGroup.findMany({ where: { campaignId: { in: sp2Campaigns.map(c => c.id) } }, select: { id: true } });
    const sp2Ads = await prisma.ad.findMany({
      where: { adgroupId: { in: sp2AdGroups.map(ag => ag.id) } },
      select: { id: true, name: true, status: true },
    });

    // SP2の7日実績
    const sp2AdIds = sp2Ads.map(a => a.id);
    const sp2Metrics = await prisma.metric.groupBy({
      by: ['adId'],
      where: { entityType: 'AD', adId: { in: sp2AdIds }, statDate: { gte: sevenDaysAgo, lt: today } },
      _sum: { spend: true, conversions: true },
    });
    const sp2MetricMap = new Map(sp2Metrics.map(m => [m.adId!, m]));

    // SP2の勝ちCR名（CV > 0のもの）
    const sp2WinningCRs = new Map<string, { cv: number; cpa: number; adName: string }>();
    for (const ad of sp2Ads) {
      const m = sp2MetricMap.get(ad.id);
      const cv = m?._sum.conversions ?? 0;
      const spend = m?._sum.spend ?? 0;
      if (cv === 0) continue;
      const parts = ad.name.split('/');
      if (parts.length >= 3) {
        const crName = parts[2];
        const existing = sp2WinningCRs.get(crName);
        if (!existing || cv > existing.cv) {
          sp2WinningCRs.set(crName, { cv, cpa: Math.round(spend / cv), adName: ad.name });
        }
      }
    }

    // SP1のすべてのCR名を取得
    const sp1Campaigns = await prisma.campaign.findMany({ where: { advertiserId: sp1Adv.id }, select: { id: true } });
    const sp1AdGroups = await prisma.adGroup.findMany({ where: { campaignId: { in: sp1Campaigns.map(c => c.id) } }, select: { id: true } });
    const sp1Ads = await prisma.ad.findMany({
      where: { adgroupId: { in: sp1AdGroups.map(ag => ag.id) } },
      select: { id: true, name: true, status: true },
    });

    // SP1の7日・30日実績
    const sp1AdIds = sp1Ads.map(a => a.id);
    const sp1Metrics7d = await prisma.metric.groupBy({
      by: ['adId'],
      where: { entityType: 'AD', adId: { in: sp1AdIds }, statDate: { gte: sevenDaysAgo, lt: today } },
      _sum: { spend: true, conversions: true },
    });
    const sp1Metrics30d = await prisma.metric.groupBy({
      by: ['adId'],
      where: { entityType: 'AD', adId: { in: sp1AdIds }, statDate: { gte: thirtyDaysAgo, lt: today } },
      _sum: { spend: true, conversions: true },
    });
    const sp1Metric7dMap = new Map(sp1Metrics7d.map(m => [m.adId!, m]));
    const sp1Metric30dMap = new Map(sp1Metrics30d.map(m => [m.adId!, m]));

    // SP1のCR名→成績マップ
    const sp1CRData = new Map<string, { ads: { name: string; status: string; cv7d: number; cv30d: number; spend7d: number; spend30d: number }[] }>();
    for (const ad of sp1Ads) {
      const parts = ad.name.split('/');
      if (parts.length < 3) continue;
      const crName = parts[2];
      const m7d = sp1Metric7dMap.get(ad.id);
      const m30d = sp1Metric30dMap.get(ad.id);
      const entry = sp1CRData.get(crName) ?? { ads: [] };
      entry.ads.push({
        name: ad.name,
        status: ad.status,
        cv7d: m7d?._sum.conversions ?? 0,
        cv30d: m30d?._sum.conversions ?? 0,
        spend7d: m7d?._sum.spend ?? 0,
        spend30d: m30d?._sum.spend ?? 0,
      });
      sp1CRData.set(crName, entry);
    }

    // 比較
    console.log('\nSP2勝ちCR → SP1での状態:');
    for (const [crName, sp2Data] of [...sp2WinningCRs.entries()].sort((a, b) => b[1].cv - a[1].cv)) {
      const sp1Data = sp1CRData.get(crName);
      console.log(`\n  【${crName}】SP2: CV=${sp2Data.cv} CPA=¥${sp2Data.cpa.toLocaleString()}`);
      if (sp1Data) {
        const totalCV7d = sp1Data.ads.reduce((s, a) => s + a.cv7d, 0);
        const totalCV30d = sp1Data.ads.reduce((s, a) => s + a.cv30d, 0);
        const totalSpend7d = sp1Data.ads.reduce((s, a) => s + a.spend7d, 0);
        const totalSpend30d = sp1Data.ads.reduce((s, a) => s + a.spend30d, 0);
        const activeCount = sp1Data.ads.filter(a => ['ENABLE', 'ACTIVE'].includes(a.status)).length;
        const disableCount = sp1Data.ads.filter(a => !['ENABLE', 'ACTIVE'].includes(a.status)).length;
        console.log(`    SP1: ${sp1Data.ads.length}本(Active:${activeCount}/Disable:${disableCount})`);
        console.log(`    SP1 7日: CV=${totalCV7d} 消化=¥${Math.round(totalSpend7d).toLocaleString()} CPA=${totalCV7d > 0 ? `¥${Math.round(totalSpend7d/totalCV7d).toLocaleString()}` : '-'}`);
        console.log(`    SP1 30日: CV=${totalCV30d} 消化=¥${Math.round(totalSpend30d).toLocaleString()} CPA=${totalCV30d > 0 ? `¥${Math.round(totalSpend30d/totalCV30d).toLocaleString()}` : '-'}`);
        // Show individual ads
        for (const a of sp1Data.ads.slice(0, 5)) {
          console.log(`      ${a.name} | ${a.status} | 7d:CV${a.cv7d}/¥${Math.round(a.spend7d).toLocaleString()} | 30d:CV${a.cv30d}/¥${Math.round(a.spend30d).toLocaleString()}`);
        }
      } else {
        console.log(`    SP1: ★未入稿★`);
      }
    }
  }

  // ===== 3. SNS導線: スマプラ vs 通常配信 =====
  console.log('\n\n============================================================');
  console.log('3. SNS導線: スマプラ vs 通常配信の成績比較');
  console.log('============================================================');

  const snsAccounts = [
    { name: 'SNS2', tiktokId: '7543540100849156112' },
    { name: 'SNS3', tiktokId: '7543540381615800337' },
  ];

  for (const acc of snsAccounts) {
    const adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: acc.tiktokId } });
    if (!adv) continue;

    const campaigns = await prisma.campaign.findMany({
      where: { advertiserId: adv.id },
      select: { id: true, name: true },
    });
    const adGroups = await prisma.adGroup.findMany({
      where: { campaignId: { in: campaigns.map(c => c.id) } },
      select: { id: true, campaignId: true },
    });
    const ads = await prisma.ad.findMany({
      where: { adgroupId: { in: adGroups.map(ag => ag.id) } },
      select: { id: true, tiktokId: true, name: true, status: true, adgroupId: true },
    });

    const campaignMap = new Map(campaigns.map(c => [c.id, c.name]));
    const agCampaignMap = new Map(adGroups.map(ag => [ag.id, ag.campaignId]));

    const smartPlusAds: typeof ads = [];
    const regularAds: typeof ads = [];

    for (const ad of ads) {
      const campaignId = agCampaignMap.get(ad.adgroupId);
      const campaignName = campaignId ? campaignMap.get(campaignId) : '';
      const isSmartPlus = (campaignName?.includes('スマ') || ad.name.includes('/スマ ') || ad.name.includes('/スマプラ'));
      if (isSmartPlus) {
        smartPlusAds.push(ad);
      } else {
        regularAds.push(ad);
      }
    }

    const getGroupMetrics = async (adList: typeof ads) => {
      if (adList.length === 0) return { spend: 0, cv: 0, imp: 0, activeCount: 0, totalCount: adList.length };
      const adIds = adList.map(a => a.id);
      const metrics = await prisma.metric.groupBy({
        by: ['adId'],
        where: { entityType: 'AD', adId: { in: adIds }, statDate: { gte: sevenDaysAgo, lt: today } },
        _sum: { spend: true, conversions: true, impressions: true },
      });
      let totalSpend = 0, totalCV = 0, totalImp = 0;
      for (const m of metrics) {
        totalSpend += m._sum.spend ?? 0;
        totalCV += m._sum.conversions ?? 0;
        totalImp += m._sum.impressions ?? 0;
      }
      return { spend: totalSpend, cv: totalCV, imp: totalImp, activeCount: adList.filter(a => ['ENABLE', 'ACTIVE'].includes(a.status)).length, totalCount: adList.length };
    };

    const sp7d = await getGroupMetrics(smartPlusAds);
    const reg7d = await getGroupMetrics(regularAds);

    console.log(`\n【${acc.name}】`);
    console.log(`  スマプラ: ${sp7d.totalCount}本(Active:${sp7d.activeCount}) | 7日CV:${sp7d.cv} | 消化:¥${Math.round(sp7d.spend).toLocaleString()} | CPA:${sp7d.cv > 0 ? `¥${Math.round(sp7d.spend/sp7d.cv).toLocaleString()}` : '-'}`);
    console.log(`  通常配信: ${reg7d.totalCount}本(Active:${reg7d.activeCount}) | 7日CV:${reg7d.cv} | 消化:¥${Math.round(reg7d.spend).toLocaleString()} | CPA:${reg7d.cv > 0 ? `¥${Math.round(reg7d.spend/reg7d.cv).toLocaleString()}` : '-'}`);

    // Top ads from each
    for (const [label, adList] of [['スマプラ', smartPlusAds], ['通常配信', regularAds]] as const) {
      if (adList.length === 0) continue;
      const adIds = adList.map(a => a.id);
      const metrics = await prisma.metric.groupBy({
        by: ['adId'],
        where: { entityType: 'AD', adId: { in: adIds }, statDate: { gte: sevenDaysAgo, lt: today } },
        _sum: { spend: true, conversions: true, impressions: true },
      });
      const sorted = metrics
        .filter(m => (m._sum.spend ?? 0) > 0)
        .sort((a, b) => (b._sum.conversions ?? 0) - (a._sum.conversions ?? 0));

      console.log(`  ${label} Top5:`);
      for (const m of sorted.slice(0, 5)) {
        const ad = adList.find(a => a.id === m.adId);
        const cv = m._sum.conversions ?? 0;
        const spend = m._sum.spend ?? 0;
        console.log(`    ${ad?.name} | CV:${cv} | 消化:¥${Math.round(spend).toLocaleString()} | CPA:${cv > 0 ? `¥${Math.round(spend/cv).toLocaleString()}` : '-'} | ${ad?.status}`);
      }
    }
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
