// TODO1: AI_3の非効率広告を特定
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()));
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const adv = await prisma.advertiser.findUnique({
    where: { tiktokAdvertiserId: '7543540647266074641' },
  });
  if (!adv) { console.log('AI_3 not found'); return; }

  const campaigns = await prisma.campaign.findMany({ where: { advertiserId: adv.id }, select: { id: true } });
  const adGroups = await prisma.adGroup.findMany({ where: { campaignId: { in: campaigns.map(c => c.id) } }, select: { id: true } });
  const ads = await prisma.ad.findMany({
    where: { adgroupId: { in: adGroups.map(ag => ag.id) }, status: { in: ['ENABLE', 'ACTIVE'] } },
    select: { id: true, tiktokId: true, name: true, status: true },
  });

  console.log(`AI_3 アクティブ広告数: ${ads.length}`);

  // Get 7-day metrics per ad
  const adIds = ads.map(a => a.id);
  const metrics = await prisma.metric.groupBy({
    by: ['adId'],
    where: { entityType: 'AD', adId: { in: adIds }, statDate: { gte: sevenDaysAgo, lt: today } },
    _sum: { spend: true, conversions: true, impressions: true },
  });

  const metricMap = new Map(metrics.map(m => [m.adId!, m]));

  // Categorize ads
  const highCPA: any[] = []; // CPA > 4032 (allowable)
  const zeroCVHighSpend: any[] = []; // CV=0 but spend > 4032
  const goodAds: any[] = []; // CPA <= 3024 (target)
  const okAds: any[] = []; // 3024 < CPA <= 4032

  for (const ad of ads) {
    const m = metricMap.get(ad.id);
    const spend = m?._sum.spend ?? 0;
    const cv = m?._sum.conversions ?? 0;
    const imp = m?._sum.impressions ?? 0;
    const cpa = cv > 0 ? spend / cv : 0;

    if (cv === 0 && spend > 4032) {
      zeroCVHighSpend.push({ ...ad, spend, cv, imp, cpa });
    } else if (cv > 0 && cpa > 4032) {
      highCPA.push({ ...ad, spend, cv, imp, cpa });
    } else if (cv > 0 && cpa <= 3024) {
      goodAds.push({ ...ad, spend, cv, imp, cpa });
    } else if (cv > 0) {
      okAds.push({ ...ad, spend, cv, imp, cpa });
    }
  }

  console.log(`\n=== 停止候補（CPA > ¥4,032）: ${highCPA.length}本 ===`);
  highCPA.sort((a, b) => b.spend - a.spend);
  let totalWasteSpend = 0;
  for (const a of highCPA.slice(0, 20)) {
    totalWasteSpend += a.spend;
    console.log(`  ${a.name} | CPA:¥${Math.round(a.cpa).toLocaleString()} | CV:${a.cv} | 消化:¥${Math.round(a.spend).toLocaleString()} | imp:${a.imp.toLocaleString()} | tiktokId:${a.tiktokId}`);
  }
  console.log(`  ... 合計無駄消化: ¥${Math.round(highCPA.reduce((s, a) => s + a.spend, 0)).toLocaleString()}`);

  console.log(`\n=== 停止候補（CV0・消化¥4,032超）: ${zeroCVHighSpend.length}本 ===`);
  zeroCVHighSpend.sort((a, b) => b.spend - a.spend);
  for (const a of zeroCVHighSpend.slice(0, 20)) {
    console.log(`  ${a.name} | 消化:¥${Math.round(a.spend).toLocaleString()} | imp:${a.imp.toLocaleString()} | tiktokId:${a.tiktokId}`);
  }
  console.log(`  ... 合計無駄消化: ¥${Math.round(zeroCVHighSpend.reduce((s, a) => s + a.spend, 0)).toLocaleString()}`);

  console.log(`\n=== 好調広告（CPA ≤ ¥3,024）: ${goodAds.length}本 ===`);
  goodAds.sort((a, b) => b.cv - a.cv);
  for (const a of goodAds.slice(0, 20)) {
    console.log(`  ${a.name} | CPA:¥${Math.round(a.cpa).toLocaleString()} | CV:${a.cv} | 消化:¥${Math.round(a.spend).toLocaleString()}`);
  }

  console.log(`\n=== まあまあ広告（¥3,024 < CPA ≤ ¥4,032）: ${okAds.length}本 ===`);

  // Extract winning CR patterns from good ads
  const crPatterns = new Map<string, { count: number; totalCV: number; totalSpend: number }>();
  for (const a of goodAds) {
    const parts = a.name.split('/');
    if (parts.length >= 3) {
      const crName = parts[2]; // CR name
      const existing = crPatterns.get(crName) ?? { count: 0, totalCV: 0, totalSpend: 0 };
      existing.count++;
      existing.totalCV += a.cv;
      existing.totalSpend += a.spend;
      crPatterns.set(crName, existing);
    }
  }

  console.log(`\n=== AI_3の勝ちCRパターン ===`);
  const sortedCR = [...crPatterns.entries()].sort((a, b) => b[1].totalCV - a[1].totalCV);
  for (const [cr, data] of sortedCR.slice(0, 20)) {
    console.log(`  ${cr}: ${data.count}本 | 合計CV:${data.totalCV} | 平均CPA:¥${Math.round(data.totalSpend / data.totalCV).toLocaleString()}`);
  }

  // Output tiktokIds for bulk pause
  const allPauseTargets = [...highCPA, ...zeroCVHighSpend];
  console.log(`\n=== 一括停止対象 tiktokId一覧（${allPauseTargets.length}本）===`);
  console.log(JSON.stringify(allPauseTargets.map(a => a.tiktokId)));

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
