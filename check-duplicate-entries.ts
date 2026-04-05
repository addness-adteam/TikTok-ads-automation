import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // ad_idで保存されている広告とsmart_plus_ad_idで保存されている広告の両方が存在するか確認

  // CR00675-CR00678 の両方のIDを確認
  const pairs = [
    { ad_id: '1850259613723809', smart_plus_ad_id: '1850253042082962', name: 'CR00678' },
    { ad_id: '1850259613721729', smart_plus_ad_id: '1850263330732082', name: 'CR00677' },
    { ad_id: '1850259613343777', smart_plus_ad_id: '1850263330733058', name: 'CR00675' },
    { ad_id: '1850259613341697', smart_plus_ad_id: '1850263330733074', name: 'CR00676' },
    { ad_id: '1850472050889730', smart_plus_ad_id: '1850472306618481', name: 'CR00679' },
    { ad_id: '1850472050886754', smart_plus_ad_id: '1850472803071026', name: 'CR00680' },
  ];

  console.log('=== 各広告のDB登録状況を確認 ===\n');

  for (const pair of pairs) {
    const adByAdId = await prisma.ad.findUnique({
      where: { tiktokId: pair.ad_id }
    });

    const adBySmartPlusId = await prisma.ad.findUnique({
      where: { tiktokId: pair.smart_plus_ad_id }
    });

    console.log(`${pair.name}:`);
    console.log(`  ad_id (${pair.ad_id}): ${adByAdId ? `✅ "${adByAdId.name}"` : '❌ なし'}`);
    console.log(`  smart_plus_ad_id (${pair.smart_plus_ad_id}): ${adBySmartPlusId ? `✅ "${adBySmartPlusId.name}"` : '❌ なし'}`);

    if (adByAdId && adBySmartPlusId) {
      console.log(`  ⚠️ 重複！両方のIDで登録されています`);
    } else if (adByAdId && !adBySmartPlusId) {
      console.log(`  ⚠️ 古い形式（ad_id）で登録されています - 修正が必要`);
    } else if (!adByAdId && adBySmartPlusId) {
      console.log(`  ✅ 正しい形式（smart_plus_ad_id）で登録されています`);
    }
    console.log('');
  }

  // 全Smart+ 広告の登録状況を確認
  console.log('\n=== AI_1アカウントの全Smart+ 広告の登録パターン ===\n');

  const ai1Ads = await prisma.ad.findMany({
    where: {
      adGroup: {
        campaign: {
          advertiser: {
            tiktokAdvertiserId: '7468288053866561553'
          }
        }
      },
      // tiktokIdが185で始まるもの（最近のSmart+ 広告）
      tiktokId: { startsWith: '185' }
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      tiktokId: true,
      name: true,
      createdAt: true
    }
  });

  // smart_plus_ad_id形式かad_id形式かを判別
  // smart_plus_ad_idは通常「日付/制作者/...」形式の名前
  // ad_id形式は「.mp4」や「TT_」で始まる名前

  let smartPlusIdFormat = 0;
  let adIdFormat = 0;

  ai1Ads.forEach(ad => {
    const isProperName = ad.name.match(/^\d{6}\//);  // 日付で始まる形式
    if (isProperName) {
      smartPlusIdFormat++;
    } else {
      adIdFormat++;
    }
  });

  console.log(`smart_plus_ad_id形式（正しい形式）: ${smartPlusIdFormat}件`);
  console.log(`ad_id形式（古い形式）: ${adIdFormat}件`);

  console.log('\n--- ad_id形式の広告（修正が必要）---');
  ai1Ads
    .filter(ad => !ad.name.match(/^\d{6}\//))
    .slice(0, 10)
    .forEach(ad => {
      console.log(`  ${ad.tiktokId} - ${ad.name}`);
    });
}

main().catch(console.error).finally(() => prisma.$disconnect());
