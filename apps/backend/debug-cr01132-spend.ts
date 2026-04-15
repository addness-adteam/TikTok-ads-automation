import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  // LP1-CR01132 を末尾に持つAdを全検索
  const ads = await prisma.ad.findMany({
    where: { name: { contains: 'LP1-CR01132' } },
    include: { adGroup: { include: { campaign: { include: { advertiser: true } } } } },
  });
  console.log(`LP1-CR01132 を含むAd: ${ads.length}件\n`);
  for (const ad of ads) {
    console.log(`=== Ad ===`);
    console.log(`  name: ${ad.name}`);
    console.log(`  tiktokId: ${ad.tiktokId}`);
    console.log(`  status: ${ad.status}`);
    console.log(`  createdAt: ${ad.createdAt.toISOString()}`);
    console.log(`  Advertiser: ${ad.adGroup.campaign.advertiser.name} (${ad.adGroup.campaign.advertiser.tiktokAdvertiserId})`);
    console.log(`  Campaign: ${ad.adGroup.campaign.name} tiktokId=${ad.adGroup.campaign.tiktokId}`);

    const metrics = await prisma.metric.findMany({
      where: { adId: ad.id, entityType: 'AD' },
      orderBy: { statDate: 'asc' },
    });
    console.log(`  全期間metric行数: ${metrics.length}`);
    let sum = 0;
    for (const m of metrics) {
      if (m.spend > 0) {
        console.log(`    ${m.statDate.toISOString().substring(0,10)} | spend=¥${m.spend.toFixed(0)} | CV=${m.conversions} | imp=${m.impressions} | createdAt=${m.createdAt.toISOString().substring(0,19)}`);
        sum += m.spend;
      }
    }
    console.log(`  全期間合計spend=¥${sum.toFixed(0)}`);
  }

  // smart_plus_ad_idやdimensionsのせいでcampaign混在がないか、Campaignの"CR01132"で検索
  console.log(`\n=== Campaign名にCR01132を含むものの全Metric合計（entityType関係なく） ===`);
  const camps = await prisma.campaign.findMany({
    where: { name: { contains: 'CR01132' } },
    include: { advertiser: true },
  });
  for (const c of camps) {
    console.log(`  Campaign: ${c.name} tiktokId=${c.tiktokId} adv=${c.advertiser.name}`);
    const cm = await prisma.metric.aggregate({
      where: { campaignId: c.id, statDate: { gte: new Date('2026-04-01T00:00:00+09:00'), lt: new Date('2026-04-15T00:00:00+09:00') } },
      _sum: { spend: true, conversions: true, impressions: true },
    });
    console.log(`   4月campaignレベル合計: spend=¥${cm._sum.spend?.toFixed(0) ?? 0} CV=${cm._sum.conversions} imp=${cm._sum.impressions}`);
  }

  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1);});
