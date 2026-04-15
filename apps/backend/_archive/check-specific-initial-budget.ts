import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: '7543540100849156112' } });
  if (!adv) { console.log('Advertiser not found'); return; }

  const campaigns = await prisma.campaign.findMany({ where: { advertiserId: adv.id }, select: { id: true } });
  console.log(`キャンペーン数: ${campaigns.length}`);

  const adGroups = await prisma.adGroup.findMany({ where: { campaignId: { in: campaigns.map(c => c.id) } } });
  console.log(`広告グループ数: ${adGroups.length}`);

  // CR00622を含む広告を検索
  const ads = await prisma.ad.findMany({
    where: { adgroupId: { in: adGroups.map(ag => ag.id) }, name: { contains: 'SNS2026' } },
  });
  console.log(`SNS2026を含む広告数: ${ads.length}`);

  // もう少し広く検索
  const allAds = await prisma.ad.findMany({
    where: { adgroupId: { in: adGroups.map(ag => ag.id) }, name: { contains: '勝ちCR' } },
  });
  console.log(`勝ちCRを含む広告数: ${allAds.length}`);

  for (const ad of allAds) {
    const ag = adGroups.find(a => a.id === ad.adgroupId);
    console.log(`\n広告名: ${ad.name}`);
    console.log(`  adgroupId(DB): ${ag?.id}`);
    console.log(`  adgroupTiktokId: ${ag?.tiktokId}`);
    console.log(`  現在budget: ¥${ag?.budget}`);
    console.log(`  initialBudget: ¥${ag?.initialBudget}`);
    console.log(`  status: ${ad.status}`);
  }

  // CR00622で検索
  const cr622 = await prisma.ad.findMany({
    where: { adgroupId: { in: adGroups.map(ag => ag.id) }, name: { contains: 'CR00622' } },
  });
  console.log(`\nCR00622を含む広告数: ${cr622.length}`);
  for (const ad of cr622) {
    const ag = adGroups.find(a => a.id === ad.adgroupId);
    console.log(`広告名: ${ad.name} | budget:¥${ag?.budget} | initialBudget:¥${ag?.initialBudget}`);
  }

  // 619も試す（今日出稿されたものなら広告名が少し違うかも）
  const recent = await prisma.ad.findMany({
    where: { adgroupId: { in: adGroups.map(ag => ag.id) }, name: { contains: '260317' } },
  });
  console.log(`\n260317を含む広告数: ${recent.length}`);
  for (const ad of recent) {
    const ag = adGroups.find(a => a.id === ad.adgroupId);
    console.log(`広告名: ${ad.name} | budget:¥${ag?.budget} | initialBudget:¥${ag?.initialBudget}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
