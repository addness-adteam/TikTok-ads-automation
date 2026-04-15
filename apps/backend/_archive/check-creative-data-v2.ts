// 横展開に必要なクリエイティブデータを確認 v2
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 1. まずAdとCreativeのスキーマを確認
  console.log('=== サンプルAd ===');
  const sampleAd = await prisma.ad.findFirst({ where: { status: 'ENABLE' } });
  if (sampleAd) console.log('Ad fields:', Object.keys(sampleAd));

  console.log('\n=== サンプルCreative ===');
  const sampleCreative = await prisma.creative.findFirst();
  if (sampleCreative) {
    console.log('Creative fields:', Object.keys(sampleCreative));
    console.log('Sample:', JSON.stringify(sampleCreative, null, 2));
  }

  // 2. AI_1/AI_2勝ちCRのクリエイティブ
  console.log('\n\n=== AI_1/AI_2 勝ちCRクリエイティブ ===');
  const aiAccounts = ['7468288053866561553', '7523128243466551303'];
  const winningCRs = ['ClaudeCode解説', 'AIまとめ', '尻込み＿ちえみさん', 'プロンプト（お絵描きムービー）', '二極化_SORA2'];

  for (const tiktokId of aiAccounts) {
    const adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: tiktokId } });
    if (!adv) continue;
    const campaigns = await prisma.campaign.findMany({ where: { advertiserId: adv.id }, select: { id: true } });
    const adGroups = await prisma.adGroup.findMany({ where: { campaignId: { in: campaigns.map(c => c.id) } }, select: { id: true } });

    for (const crName of winningCRs) {
      const ads = await prisma.ad.findMany({
        where: { adgroupId: { in: adGroups.map(ag => ag.id) }, name: { contains: crName }, status: 'ENABLE' },
        take: 1,
      });
      for (const ad of ads) {
        const creative = ad.creativeId ? await prisma.creative.findUnique({ where: { id: ad.creativeId } }).catch(() => null) : null;
        console.log(`\n${adv.name} | ${ad.name}`);
        console.log(`  tiktokAdId: ${ad.tiktokId} | creativeId(DB): ${ad.creativeId}`);
        console.log(`  landingPageUrl: ${ad.landingPageUrl ?? 'N/A'}`);
        console.log(`  adText: ${ad.adText?.substring(0, 50) ?? 'N/A'}`);
        if (creative) {
          console.log(`  creative.tiktokVideoId: ${(creative as any).tiktokVideoId ?? 'N/A'}`);
          console.log(`  creative.tiktokImageId: ${(creative as any).tiktokImageId ?? 'N/A'}`);
          console.log(`  creative.type: ${(creative as any).type ?? 'N/A'}`);
          console.log(`  creative.name: ${creative.name ?? 'N/A'}`);
        } else {
          console.log(`  creative: NOT FOUND / NULL`);
        }
      }
    }
  }

  // 3. SP2勝ちCRのクリエイティブ
  console.log('\n\n=== SP2 勝ちCRクリエイティブ ===');
  const sp2Adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: '7592868952431362066' } });
  if (sp2Adv) {
    const campaigns = await prisma.campaign.findMany({ where: { advertiserId: sp2Adv.id }, select: { id: true } });
    const adGroups = await prisma.adGroup.findMany({ where: { campaignId: { in: campaigns.map(c => c.id) } }, select: { id: true } });
    const sp2Names = ['AI副業の嘘セミナー 毎日投稿', 'AI副業の嘘セミナー インスタ', 'AI副業の嘘 冒頭8', 'TikTok_冒頭2-①'];

    for (const crName of sp2Names) {
      const ads = await prisma.ad.findMany({
        where: { adgroupId: { in: adGroups.map(ag => ag.id) }, name: { contains: crName } },
        take: 1,
      });
      for (const ad of ads) {
        const creative = ad.creativeId ? await prisma.creative.findUnique({ where: { id: ad.creativeId } }).catch(() => null) : null;
        console.log(`\nSP2 | ${ad.name}`);
        console.log(`  tiktokAdId: ${ad.tiktokId} | creativeId(DB): ${ad.creativeId}`);
        console.log(`  landingPageUrl: ${ad.landingPageUrl ?? 'N/A'}`);
        if (creative) {
          console.log(`  creative.tiktokVideoId: ${(creative as any).tiktokVideoId ?? 'N/A'}`);
          console.log(`  creative.tiktokImageId: ${(creative as any).tiktokImageId ?? 'N/A'}`);
          console.log(`  creative.type: ${(creative as any).type ?? 'N/A'}`);
        } else {
          console.log(`  creative: NOT FOUND / NULL`);
        }
      }
    }
  }

  // 4. SNS3勝ちCRのクリエイティブ
  console.log('\n\n=== SNS3 勝ちCRクリエイティブ ===');
  const sns3Adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: '7543540381615800337' } });
  if (sns3Adv) {
    const campaigns = await prisma.campaign.findMany({ where: { advertiserId: sns3Adv.id }, select: { id: true } });
    const adGroups = await prisma.adGroup.findMany({ where: { campaignId: { in: campaigns.map(c => c.id) } }, select: { id: true } });
    const snsNames = ['1年後悔ベッドだらだら', '尻込み＿ちえみさん'];

    for (const crName of snsNames) {
      const ads = await prisma.ad.findMany({
        where: { adgroupId: { in: adGroups.map(ag => ag.id) }, name: { contains: crName }, status: 'ENABLE' },
        take: 1,
      });
      for (const ad of ads) {
        const creative = ad.creativeId ? await prisma.creative.findUnique({ where: { id: ad.creativeId } }).catch(() => null) : null;
        console.log(`\nSNS3 | ${ad.name}`);
        console.log(`  tiktokAdId: ${ad.tiktokId} | creativeId(DB): ${ad.creativeId}`);
        console.log(`  landingPageUrl: ${ad.landingPageUrl ?? 'N/A'}`);
        if (creative) {
          console.log(`  creative.tiktokVideoId: ${(creative as any).tiktokVideoId ?? 'N/A'}`);
          console.log(`  creative.tiktokImageId: ${(creative as any).tiktokImageId ?? 'N/A'}`);
          console.log(`  creative.type: ${(creative as any).type ?? 'N/A'}`);
        } else {
          console.log(`  creative: NOT FOUND / NULL`);
        }
      }
    }
  }

  // 5. ピクセルIDはAdGroupテーブルにないはず。直近作成されたAdGroupから確認
  console.log('\n\n=== AdGroupスキーマ確認 ===');
  const sampleAG = await prisma.adGroup.findFirst({ orderBy: { createdAt: 'desc' } });
  if (sampleAG) console.log('AdGroup fields:', Object.keys(sampleAG));

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
