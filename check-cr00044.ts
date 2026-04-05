import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== CR00044 の同期結果確認 ===\n');

  // CR00044を含む広告を検索
  const ads = await prisma.ad.findMany({
    where: {
      OR: [
        { name: { contains: 'CR00044' } },
        { name: { contains: 'SNSガチャ2' } }
      ]
    },
    include: {
      adGroup: {
        select: {
          campaign: {
            select: {
              advertiser: {
                select: { name: true, tiktokAdvertiserId: true }
              }
            }
          }
        }
      }
    }
  });

  if (ads.length === 0) {
    console.log('❌ CR00044の広告が見つかりませんでした');

    // SNS3アカウントの最近の広告を確認
    console.log('\n=== SNSアカウントの最近の広告 ===\n');

    const snsAds = await prisma.ad.findMany({
      where: {
        adGroup: {
          campaign: {
            advertiser: { name: { contains: 'SNS' } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: {
        adGroup: {
          select: {
            campaign: {
              select: {
                advertiser: { select: { name: true } }
              }
            }
          }
        }
      }
    });

    snsAds.forEach(ad => {
      const createdJST = new Date(ad.createdAt.getTime() + 9 * 60 * 60 * 1000);
      const isProperName = ad.name.match(/^\d{6}\//);
      console.log(createdJST.toISOString().substring(0, 19) + ' - ' + ad.adGroup.campaign.advertiser.name);
      console.log('  ' + (isProperName ? '✅' : '❌') + ' ' + ad.name.substring(0, 60));
      console.log('  tiktokId: ' + ad.tiktokId);
    });

    return;
  }

  for (const ad of ads) {
    console.log('広告名: ' + ad.name);
    console.log('tiktokId: ' + ad.tiktokId);
    console.log('アカウント: ' + ad.adGroup.campaign.advertiser.name);

    // メトリクスを別途取得
    const metrics = await prisma.metric.findMany({
      where: { adId: ad.id },
      orderBy: { createdAt: 'desc' },
      take: 3
    });

    console.log('メトリクス件数: ' + metrics.length);

    if (metrics.length > 0) {
      console.log('\n最新メトリクス:');
      metrics.forEach((m: any) => {
        console.log('  spend=' + m.spend + ', impressions=' + m.impressions);
      });
    }
    console.log('');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
