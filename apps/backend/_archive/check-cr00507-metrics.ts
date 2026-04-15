import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();
const p = new PrismaClient();

async function main() {
  // LP2-CR00507を含む広告を検索
  const ads = await p.ad.findMany({
    where: { name: { contains: 'LP2-CR00507' } },
    select: { id: true, tiktokId: true, name: true, status: true },
  });
  console.log('=== LP2-CR00507 の広告 ===');
  for (const a of ads) {
    console.log(`  ${a.tiktokId} | ${a.status} | ${a.name}`);
  }

  // 各広告のメトリクス（全レコード）
  for (const ad of ads) {
    const metrics = await p.metric.findMany({
      where: {
        adId: ad.id,
        statDate: { gte: new Date('2026-03-14T00:00:00+09:00'), lte: new Date('2026-03-21T23:59:59+09:00') },
      },
      orderBy: { statDate: 'asc' },
    });
    console.log(`\n=== ${ad.tiktokId} のメトリクス (${metrics.length}件) ===`);
    let totalSpend = 0;
    for (const m of metrics) {
      const d = m.statDate.toISOString().split('T')[0];
      console.log(`  ${d} | entityType=${m.entityType} | spend=¥${m.spend} | imp=${m.impressions} | cv=${m.conversions} | id=${m.id}`);
      totalSpend += m.spend;
    }
    console.log(`  合計spend: ¥${totalSpend}`);

    // campaignId, adgroupId経由のメトリクスもチェック
    const campMetrics = await p.metric.findMany({
      where: {
        campaignId: { not: null },
        statDate: { gte: new Date('2026-03-14T00:00:00+09:00'), lte: new Date('2026-03-21T23:59:59+09:00') },
      },
    });
  }

  await p.$disconnect();
}
main();
