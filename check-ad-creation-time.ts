import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 該当広告のcreatedAt/updatedAtを確認
  const ads = await prisma.ad.findMany({
    where: {
      tiktokId: {
        in: ['1850472050889730', '1850472050886754']
      }
    },
    select: {
      id: true,
      tiktokId: true,
      name: true,
      createdAt: true,
      updatedAt: true,
    }
  });

  console.log('=== 該当広告のDB作成日時 ===\n');
  ads.forEach(ad => {
    console.log(`tiktokId: ${ad.tiktokId}`);
    console.log(`name: ${ad.name}`);
    console.log(`createdAt: ${ad.createdAt.toISOString()}`);
    console.log(`updatedAt: ${ad.updatedAt.toISOString()}`);
    console.log('');
  });

  // 同じAdGroupの他の広告を確認
  if (ads.length > 0) {
    const adGroup = await prisma.adGroup.findFirst({
      where: {
        ads: {
          some: {
            tiktokId: '1850472050889730'
          }
        }
      }
    });

    if (adGroup) {
      const otherAds = await prisma.ad.findMany({
        where: { adgroupId: adGroup.id },
        orderBy: { createdAt: 'desc' },
        select: {
          tiktokId: true,
          name: true,
          createdAt: true
        }
      });

      console.log(`\n=== 同じAdGroup (${adGroup.name}) の全広告 ===\n`);
      otherAds.forEach(ad => {
        console.log(`${ad.createdAt.toISOString()} - ${ad.tiktokId} - ${ad.name}`);
      });
    }
  }

  // 最近同期された広告を確認（12/2以降）
  console.log('\n=== 12/2以降に作成された広告 (AI_1アカウント) ===\n');
  const recentAds = await prisma.ad.findMany({
    where: {
      createdAt: { gte: new Date('2025-12-02T00:00:00Z') },
      adGroup: {
        campaign: {
          advertiser: {
            tiktokAdvertiserId: '7468288053866561553'
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      tiktokId: true,
      name: true,
      createdAt: true
    }
  });

  if (recentAds.length > 0) {
    recentAds.forEach(ad => {
      console.log(`${ad.createdAt.toISOString()} - ${ad.tiktokId} - ${ad.name}`);
    });
  } else {
    console.log('12/2以降に作成された広告はありません');
  }

  // 12/2の修正後に同期されたSmart+ 広告（smart_plus_ad_idがtiktokIdのもの）を探す
  console.log('\n=== smart_plus_ad_id形式でtiktokIdが保存されている広告を確認 ===\n');

  // smart_plus_ad_idは1850...の形式で、通常のad_idより大きい傾向がある
  // ただし、どちらも1850で始まるので区別が難しい
  // 実際にsmart_plus/ad/get APIから取得したIDと比較する必要がある

  const knownSmartPlusIds = [
    '1850472306618481', '1850472803071026',  // CR00679, CR00680
    '1850253042082962', '1850263330732082', '1850263330733058', '1850263330733074',  // CR00675-678
  ];

  const adsWithSmartPlusId = await prisma.ad.findMany({
    where: {
      tiktokId: { in: knownSmartPlusIds }
    },
    select: {
      tiktokId: true,
      name: true,
      createdAt: true
    }
  });

  if (adsWithSmartPlusId.length > 0) {
    console.log(`Found ${adsWithSmartPlusId.length} ads with smart_plus_ad_id as tiktokId:`);
    adsWithSmartPlusId.forEach(ad => {
      console.log(`  ${ad.tiktokId} - ${ad.name}`);
    });
  } else {
    console.log('❌ smart_plus_ad_id形式でtiktokIdが保存されている広告は見つかりませんでした');
    console.log('   → 12/2の修正が正しく機能していない可能性があります');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
