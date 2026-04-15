// 横展開に必要なクリエイティブデータを確認
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 1. AI_1/AI_2の勝ちCRのクリエイティブ情報
  console.log('=== AI_1/AI_2 勝ちCRのクリエイティブ情報 ===');

  const winningAdNames = [
    'ClaudeCode解説',
    'AIまとめ',
    '尻込み＿ちえみさん',
    'プロンプト（お絵描きムービー）',
    '二極化_SORA2_冒頭1_中間2-2',
    '箕輪さんまとめ',
  ];

  const aiAccounts = ['7468288053866561553', '7523128243466551303'];

  for (const tiktokId of aiAccounts) {
    const adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: tiktokId } });
    if (!adv) continue;

    const campaigns = await prisma.campaign.findMany({ where: { advertiserId: adv.id }, select: { id: true } });
    const adGroups = await prisma.adGroup.findMany({ where: { campaignId: { in: campaigns.map(c => c.id) } }, select: { id: true } });

    for (const crName of winningAdNames) {
      const ads = await prisma.ad.findMany({
        where: {
          adgroupId: { in: adGroups.map(ag => ag.id) },
          name: { contains: crName },
          status: { in: ['ENABLE', 'ACTIVE'] },
        },
        include: {
          adgroup: {
            include: {
              campaign: {
                include: { advertiser: true },
              },
            },
          },
        },
        take: 2,
      });

      if (ads.length === 0) continue;

      for (const ad of ads) {
        // Get creative info
        const creative = ad.creativeId ? await prisma.creative.findUnique({ where: { id: ad.creativeId } }) : null;

        console.log(`\n【${ad.adgroup.campaign.advertiser.name}】${ad.name}`);
        console.log(`  adId: ${ad.tiktokId}`);
        console.log(`  creativeId(DB): ${ad.creativeId}`);
        console.log(`  landingPageUrl: ${(ad as any).landingPageUrl ?? 'N/A'}`);
        console.log(`  adText: ${(ad as any).adText ?? 'N/A'}`);
        console.log(`  identityId: ${(ad as any).identityId ?? 'N/A'}`);
        if (creative) {
          console.log(`  creative.videoId: ${(creative as any).videoId ?? 'N/A'}`);
          console.log(`  creative.imageIds: ${JSON.stringify((creative as any).imageIds ?? 'N/A')}`);
          console.log(`  creative.type: ${(creative as any).type ?? 'N/A'}`);
          console.log(`  creative.tiktokId: ${(creative as any).tiktokId ?? 'N/A'}`);
        } else {
          console.log(`  creative: NOT FOUND`);
        }
      }
    }
  }

  // 2. SP2の勝ちCRのクリエイティブ情報
  console.log('\n\n=== SP2 勝ちCRのクリエイティブ情報 ===');
  const sp2WinningNames = [
    'AI副業の嘘セミナー 毎日投稿',
    'AI副業の嘘セミナー インスタ',
    '1日2時間あったら',
    'AI副業の嘘 冒頭8',
    'TikTok_冒頭2-①',
  ];

  const sp2Adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: '7592868952431362066' } });
  if (sp2Adv) {
    const campaigns = await prisma.campaign.findMany({ where: { advertiserId: sp2Adv.id }, select: { id: true } });
    const adGroups = await prisma.adGroup.findMany({ where: { campaignId: { in: campaigns.map(c => c.id) } }, select: { id: true } });

    for (const crName of sp2WinningNames) {
      const ads = await prisma.ad.findMany({
        where: {
          adgroupId: { in: adGroups.map(ag => ag.id) },
          name: { contains: crName },
        },
        take: 2,
      });

      for (const ad of ads) {
        const creative = ad.creativeId ? await prisma.creative.findUnique({ where: { id: ad.creativeId } }) : null;
        console.log(`\n【SP2】${ad.name}`);
        console.log(`  adId: ${ad.tiktokId}`);
        console.log(`  creativeId(DB): ${ad.creativeId}`);
        console.log(`  landingPageUrl: ${(ad as any).landingPageUrl ?? 'N/A'}`);
        console.log(`  adText: ${(ad as any).adText ?? 'N/A'}`);
        if (creative) {
          console.log(`  creative.videoId: ${(creative as any).videoId ?? 'N/A'}`);
          console.log(`  creative.type: ${(creative as any).type ?? 'N/A'}`);
        } else {
          console.log(`  creative: NOT FOUND`);
        }
      }
    }
  }

  // 3. SNS3の勝ちCRのクリエイティブ情報
  console.log('\n\n=== SNS3 勝ちCRのクリエイティブ情報 ===');
  const sns3Adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: '7543540381615800337' } });
  if (sns3Adv) {
    const campaigns = await prisma.campaign.findMany({ where: { advertiserId: sns3Adv.id }, select: { id: true } });
    const adGroups = await prisma.adGroup.findMany({ where: { campaignId: { in: campaigns.map(c => c.id) } }, select: { id: true } });

    const snsWinning = ['1年後悔ベッドだらだら', '尻込み＿ちえみさん', 'SNSまとめ'];
    for (const crName of snsWinning) {
      const ads = await prisma.ad.findMany({
        where: {
          adgroupId: { in: adGroups.map(ag => ag.id) },
          name: { contains: crName },
          status: { in: ['ENABLE', 'ACTIVE'] },
        },
        take: 2,
      });

      for (const ad of ads) {
        const creative = ad.creativeId ? await prisma.creative.findUnique({ where: { id: ad.creativeId } }) : null;
        console.log(`\n【SNS3】${ad.name}`);
        console.log(`  adId: ${ad.tiktokId}`);
        console.log(`  creativeId(DB): ${ad.creativeId}`);
        console.log(`  landingPageUrl: ${(ad as any).landingPageUrl ?? 'N/A'}`);
        if (creative) {
          console.log(`  creative.videoId: ${(creative as any).videoId ?? 'N/A'}`);
          console.log(`  creative.type: ${(creative as any).type ?? 'N/A'}`);
        } else {
          console.log(`  creative: NOT FOUND`);
        }
      }
    }
  }

  // 4. Check pixel IDs for target accounts
  console.log('\n\n=== 各アカウントのピクセルID確認 ===');
  // Pixel IDs are typically in campaign/adgroup settings, let me check adgroups
  const targetAccounts = [
    { name: 'AI_3', tiktokId: '7543540647266074641' },
    { name: 'AI_4', tiktokId: '7580666710525493255' },
    { name: 'SP1', tiktokId: '7474920444831875080' },
    { name: 'SNS2', tiktokId: '7543540100849156112' },
  ];

  for (const acc of targetAccounts) {
    const adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: acc.tiktokId } });
    if (!adv) continue;
    const campaigns = await prisma.campaign.findMany({ where: { advertiserId: adv.id }, select: { id: true } });
    const adGroups = await prisma.adGroup.findMany({
      where: { campaignId: { in: campaigns.map(c => c.id) } },
      select: { id: true, name: true, pixelId: true },
      take: 5,
    });
    console.log(`\n${acc.name}:`);
    for (const ag of adGroups) {
      if ((ag as any).pixelId) {
        console.log(`  adGroup: ${ag.name} | pixelId: ${(ag as any).pixelId}`);
      }
    }
  }

  // 5. Check Ad table schema for available fields
  console.log('\n\n=== Ad テーブルのサンプルデータ ===');
  const sampleAd = await prisma.ad.findFirst({
    where: { status: 'ENABLE' },
  });
  if (sampleAd) {
    console.log('Ad fields:', Object.keys(sampleAd));
    console.log('Sample:', JSON.stringify(sampleAd, null, 2));
  }

  // 6. Check Creative table schema
  console.log('\n\n=== Creative テーブルのサンプル ===');
  const sampleCreative = await prisma.creative.findFirst();
  if (sampleCreative) {
    console.log('Creative fields:', Object.keys(sampleCreative));
    console.log('Sample:', JSON.stringify(sampleCreative, null, 2));
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
