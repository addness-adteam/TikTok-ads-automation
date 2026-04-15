import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAdvertiser() {
  console.log('🔍 Advertiser確認開始\n');

  const tiktokAdvertiserId = '7247073333517238273';

  // Advertiserを検索
  console.log(`📡 TikTok Advertiser ID: ${tiktokAdvertiserId} を検索中...\n`);

  const advertiser = await prisma.advertiser.findUnique({
    where: { tiktokAdvertiserId },
    include: { appeal: true },
  });

  if (advertiser) {
    console.log('✅ Advertiserが見つかりました:');
    console.log('   UUID: ' + advertiser.id);
    console.log('   Name: ' + advertiser.name);
    console.log('   TikTok Advertiser ID: ' + advertiser.tiktokAdvertiserId);
    console.log('   Appeal: ' + (advertiser.appeal ? advertiser.appeal.name : 'なし'));
    console.log('   Created: ' + advertiser.createdAt);
  } else {
    console.log('❌ Advertiserが見つかりませんでした');
    console.log('\n💡 解決策: Advertiserをデータベースに追加する必要があります');
    console.log('   1. フロントエンドからAdvertiserを登録');
    console.log('   2. または、DBに直接Advertiserレコードを追加');
  }

  // すべてのAdvertiserを表示
  console.log('\n📋 データベース内のすべてのAdvertiser:');
  const allAdvertisers = await prisma.advertiser.findMany({
    include: { appeal: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  console.log(`総件数: ${allAdvertisers.length}件\n`);

  allAdvertisers.forEach((adv, index) => {
    console.log(`${index + 1}. ${adv.name}`);
    console.log(`   UUID: ${adv.id}`);
    console.log(`   TikTok ID: ${adv.tiktokAdvertiserId}`);
    console.log(`   Appeal: ${adv.appeal ? adv.appeal.name : 'なし'}`);
    console.log('');
  });

  await prisma.$disconnect();
}

checkAdvertiser().catch(console.error);
