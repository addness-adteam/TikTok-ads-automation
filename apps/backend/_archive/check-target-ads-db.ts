import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // CR00262の広告を検索
  const ads262 = await prisma.ad.findMany({
    where: { name: { contains: 'CR00262' } },
    include: { metrics: { orderBy: { statDate: 'desc' }, take: 30 } }
  });
  console.log('CR00262を含む広告数:', ads262.length);
  for (const ad of ads262) {
    console.log('  広告名:', ad.name);
    console.log('  ID:', ad.id, 'TikTok ID:', ad.tiktokId);
    console.log('  メトリクス数:', ad.metrics.length);
    if (ad.metrics.length > 0) {
      console.log('  最近のメトリクス:');
      ad.metrics.slice(0, 5).forEach(m => console.log('    ', m.statDate.toISOString().split('T')[0], 'spend:', m.spend, 'impressions:', m.impressions, 'cpa:', m.cpa));
    }
    console.log('');
  }

  // CR00278の広告を検索
  const ads278 = await prisma.ad.findMany({
    where: { name: { contains: 'CR00278' } },
    include: { metrics: { orderBy: { statDate: 'desc' }, take: 30 } }
  });
  console.log('CR00278を含む広告数:', ads278.length);
  for (const ad of ads278) {
    console.log('  広告名:', ad.name);
    console.log('  ID:', ad.id, 'TikTok ID:', ad.tiktokId);
    console.log('  メトリクス数:', ad.metrics.length);
    if (ad.metrics.length > 0) {
      console.log('  最近のメトリクス:');
      ad.metrics.slice(0, 5).forEach(m => console.log('    ', m.statDate.toISOString().split('T')[0], 'spend:', m.spend, 'impressions:', m.impressions, 'cpa:', m.cpa));
    }
    console.log('');
  }

  // 広告名で完全一致検索
  console.log('\n=== 完全一致検索 ===');
  const exactAd = await prisma.ad.findFirst({
    where: { name: '260113/鈴木織大/おーい会社員_今スキルプラスに入ること/LP2-CR00262' },
  });
  console.log('完全一致(CR00262):', exactAd ? 'found' : 'not found');

  await prisma.$disconnect();
}
main();
