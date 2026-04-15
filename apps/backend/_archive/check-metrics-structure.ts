import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // CR00262の広告メトリクスを全て取得
  const ad = await prisma.ad.findFirst({
    where: { name: { contains: 'CR00262' } },
    include: {
      metrics: {
        orderBy: { statDate: 'asc' },
      }
    }
  });

  if (!ad) {
    console.log('広告が見つかりません');
    return;
  }

  console.log('広告名:', ad.name);
  console.log('メトリクス数:', ad.metrics.length);
  console.log('\n日付別メトリクス:');
  console.log('日付, impressions, clicks, spend, conversions, ctr, cpm, cpa');

  for (const m of ad.metrics) {
    const date = new Date(m.statDate).toISOString().split('T')[0];
    console.log(`${date}, ${m.impressions}, ${m.clicks}, ${m.spend}, ${m.conversions}, ${m.ctr.toFixed(2)}, ${m.cpm.toFixed(2)}, ${m.cpa.toFixed(2)}`);
  }

  await prisma.$disconnect();
}
main();
