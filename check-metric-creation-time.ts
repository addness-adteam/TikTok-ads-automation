import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('='.repeat(80));
  console.log('メトリクス作成日時の確認');
  console.log('広告: 251128/高橋海斗/ピザ→問題ないです（リール投稿）/LP1-CR00586');
  console.log('='.repeat(80));

  // 広告を検索
  const ad = await prisma.ad.findFirst({
    where: {
      name: '251128/高橋海斗/ピザ→問題ないです（リール投稿）/LP1-CR00586'
    }
  });

  if (!ad) {
    console.log('広告が見つかりません');
    await prisma.$disconnect();
    return;
  }

  console.log(`\n広告ID: ${ad.id}`);
  console.log(`TikTok ID: ${ad.tiktokId}`);

  // このadIdを持つメトリクスを全て取得
  const metrics = await prisma.metric.findMany({
    where: {
      adId: ad.id
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log(`\nメトリクス数: ${metrics.length}`);
  console.log('\n詳細:');

  for (const m of metrics) {
    const statDateStr = m.statDate.toISOString();
    const createdAtStr = m.createdAt.toISOString();
    console.log(`  ID: ${m.id}`);
    console.log(`    statDate:  ${statDateStr} (${m.statDate.toLocaleDateString('ja-JP')})`);
    console.log(`    createdAt: ${createdAtStr} (${m.createdAt.toLocaleString('ja-JP')})`);
    console.log(`    spend: ¥${m.spend.toLocaleString()}, imp: ${m.impressions}, clicks: ${m.clicks}`);
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
