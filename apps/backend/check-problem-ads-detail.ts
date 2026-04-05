import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

async function check() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  // 問題の広告のad_id（TikTok API /ad/get/ が返すID）
  const adIds = [
    '1849925131931953', // 箕輪さん
    '1849940699730961', // ピザ
  ];

  // 問題の広告のsmart_plus_ad_id（広告マネージャー上のID）
  const smartPlusAdIds = [
    '1849925125797105', // 箕輪さん
    '1849940699726881', // ピザ
    '1850253042082962', // 配達員
  ];

  console.log('========================================');
  console.log('問題広告の詳細確認');
  console.log('========================================\n');

  console.log('【1】ad_idで検索:');
  for (const adId of adIds) {
    const ad = await prisma.ad.findUnique({
      where: { tiktokId: adId },
      include: {
        adGroup: {
          include: { campaign: true }
        },
        metrics: {
          orderBy: { statDate: 'desc' },
          take: 5
        }
      }
    });

    if (ad) {
      console.log(`\n  ✓ ${adId}:`);
      console.log(`    DB ID: ${ad.id}`);
      console.log(`    tiktokId: ${ad.tiktokId}`);
      console.log(`    name: ${ad.name}`);
      console.log(`    bidType: ${ad.adGroup.bidType}`);
      console.log(`    campaign: ${ad.adGroup.campaign.name}`);
      console.log(`    メトリクス: ${ad.metrics.length}件`);
      if (ad.metrics.length > 0) {
        ad.metrics.forEach(m => {
          console.log(`      ${m.statDate.toISOString().split('T')[0]}: spend=¥${m.spend}, imp=${m.impressions}`);
        });
      }
    } else {
      console.log(`  ✗ ${adId}: 見つかりませんでした`);
    }
  }

  console.log('\n\n【2】smart_plus_ad_idで検索:');
  for (const spAdId of smartPlusAdIds) {
    const ad = await prisma.ad.findUnique({
      where: { tiktokId: spAdId },
      include: {
        adGroup: {
          include: { campaign: true }
        },
        metrics: {
          orderBy: { statDate: 'desc' },
          take: 5
        }
      }
    });

    if (ad) {
      console.log(`\n  ✓ ${spAdId}:`);
      console.log(`    DB ID: ${ad.id}`);
      console.log(`    tiktokId: ${ad.tiktokId}`);
      console.log(`    name: ${ad.name}`);
      console.log(`    bidType: ${ad.adGroup.bidType}`);
      console.log(`    メトリクス: ${ad.metrics.length}件`);
    } else {
      console.log(`  ✗ ${spAdId}: 見つかりませんでした`);
    }
  }

  // 配達員の広告のad_idを確認
  console.log('\n\n【3】配達員広告のad_id (1850259613723809) で検索:');
  const haitatsuAd = await prisma.ad.findUnique({
    where: { tiktokId: '1850259613723809' },
    include: {
      adGroup: true,
      metrics: { take: 3, orderBy: { statDate: 'desc' } }
    }
  });

  if (haitatsuAd) {
    console.log(`  ✓ 見つかりました: ${haitatsuAd.name}`);
    console.log(`    メトリクス: ${haitatsuAd.metrics.length}件`);
  } else {
    console.log('  ✗ 見つかりませんでした');
  }

  await app.close();
}
check();
