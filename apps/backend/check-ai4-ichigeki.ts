import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const adv = await prisma.advertiser.findFirst({ where: { tiktokAdvertiserId: '7580666710525493255' } });
  if (!adv) { console.log('AI_4 not found'); return; }
  console.log(`AI_4 internal id: ${adv.id}, name: ${adv.name}`);

  const ads = await prisma.ad.findMany({
    where: {
      name: { contains: '一撃YouTube' },
      adGroup: { campaign: { advertiserId: adv.id } },
    },
    include: { adGroup: { include: { campaign: true } } },
  });
  console.log(`\nAI_4で「一撃YouTube」を含む広告: ${ads.length}件`);
  for (const ad of ads) {
    console.log(`\n--- Ad ---`);
    console.log(`  ad.id: ${ad.id}`);
    console.log(`  tiktokId: ${ad.tiktokId}`);
    console.log(`  name: ${ad.name}`);
    console.log(`  status: ${ad.status}`);
    console.log(`  createdAt: ${ad.createdAt.toISOString()}`);
    console.log(`  campaign: ${ad.adGroup.campaign.name} (${ad.adGroup.campaign.tiktokId})`);

    const allMetrics = await prisma.metric.findMany({
      where: { adId: ad.id, entityType: 'AD' },
      orderBy: { statDate: 'asc' },
    });
    console.log(`  全期間metric件数: ${allMetrics.length}`);
    let total = { spend: 0, cv: 0, imp: 0 };
    for (const m of allMetrics) {
      total.spend += m.spend;
      total.cv += m.conversions;
      total.imp += m.impressions;
    }
    console.log(`  全期間合計: spend=¥${total.spend.toFixed(0)} CV=${total.cv} imp=${total.imp}`);
    console.log(`  日別（spend>0のみ）:`);
    for (const m of allMetrics) {
      if (m.spend > 0 || m.conversions > 0) {
        console.log(`    ${m.statDate.toISOString().substring(0,10)} | spend=¥${m.spend.toFixed(0)} | CV=${m.conversions} | imp=${m.impressions} | cpa(stored)=${m.cpa}`);
      }
    }
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
