import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('='.repeat(80));
  console.log('広告費確認: 251128/高橋海斗/ピザ→問題ないです（リール投稿）/LP1-CR00586');
  console.log('広告アカウント: 7247073333517238273');
  console.log('='.repeat(80));

  // 広告アカウントを取得
  const advertiser = await prisma.advertiser.findFirst({
    where: { tiktokAdvertiserId: '7247073333517238273' }
  });

  if (!advertiser) {
    console.log('広告アカウントが見つかりません');
    await prisma.$disconnect();
    return;
  }

  console.log(`\n広告アカウント名: ${advertiser.name}`);
  console.log(`内部ID: ${advertiser.id}`);

  // 広告名で検索（部分一致）- 251128とCR00586の両方を含む
  const ads = await prisma.ad.findMany({
    where: {
      AND: [
        { name: { contains: '251128' } },
        { name: { contains: 'CR00586' } }
      ],
      adGroup: {
        campaign: {
          advertiserId: advertiser.id
        }
      }
    },
    include: {
      adGroup: {
        include: {
          campaign: true
        }
      },
      metrics: {
        orderBy: { statDate: 'desc' }
      }
    }
  });

  console.log(`\n該当する広告: ${ads.length} 件`);

  for (const ad of ads) {
    console.log('\n' + '='.repeat(60));
    console.log(`広告名: ${ad.name}`);
    console.log(`TikTok ID: ${ad.tiktokId}`);
    console.log(`ステータス: ${ad.status}`);
    console.log(`キャンペーン: ${ad.adGroup.campaign.name}`);
    console.log(`広告グループ: ${ad.adGroup.name}`);

    let totalSpend = 0;
    for (const m of ad.metrics) {
      totalSpend += m.spend;
    }
    console.log(`\nメトリクス数: ${ad.metrics.length}`);
    console.log(`合計広告費: ¥${totalSpend.toLocaleString()}`);

    if (ad.metrics.length > 0) {
      console.log('\n日別メトリクス (直近10件):');
      for (const m of ad.metrics.slice(0, 10)) {
        const dateStr = m.statDate.toISOString().split('T')[0];
        console.log(`  ${dateStr}: ¥${m.spend.toLocaleString()} (imp: ${m.impressions}, clicks: ${m.clicks}, cv: ${m.conversions})`);
      }
    }
  }

  // 完全一致でも検索
  console.log('\n\n' + '='.repeat(60));
  console.log('完全一致検索');
  console.log('='.repeat(60));

  const exactAd = await prisma.ad.findFirst({
    where: {
      name: '251128/高橋海斗/ピザ→問題ないです（リール投稿）/LP1-CR00586'
    },
    include: {
      metrics: {
        orderBy: { statDate: 'desc' }
      }
    }
  });

  if (exactAd) {
    console.log(`\n通常広告として存在`);
    console.log(`TikTok ID: ${exactAd.tiktokId}`);
    let totalSpend = 0;
    for (const m of exactAd.metrics) {
      totalSpend += m.spend;
    }
    console.log(`合計広告費: ¥${totalSpend.toLocaleString()}`);
  } else {
    console.log('\n完全一致する通常広告が見つかりません');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
