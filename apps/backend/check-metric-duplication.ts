import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();
const p = new PrismaClient();

async function main() {
  // AI_1の有名なCR（LP1-CR01047）で確認
  const ad1 = await p.ad.findFirst({ where: { name: { contains: 'LP1-CR01047' } } });
  if (ad1) {
    const metrics = await p.metric.findMany({
      where: { adId: ad1.id, statDate: { gte: new Date('2026-03-14'), lte: new Date('2026-03-22') } },
      orderBy: { statDate: 'asc' },
    });
    console.log(`=== AI_1 LP1-CR01047 (${ad1.tiktokId}) ===`);
    for (const m of metrics) {
      console.log(`  ${m.statDate.toISOString().split('T')[0]} | spend=¥${m.spend} | imp=${m.impressions} | cv=${m.conversions}`);
    }
  }

  // SP1のLP2-CR00468でも確認
  const ad2 = await p.ad.findFirst({ where: { name: { contains: 'LP2-CR00468' } } });
  if (ad2) {
    const metrics = await p.metric.findMany({
      where: { adId: ad2.id, statDate: { gte: new Date('2026-03-14'), lte: new Date('2026-03-22') } },
      orderBy: { statDate: 'asc' },
    });
    console.log(`\n=== SP1 LP2-CR00468 (${ad2.tiktokId}) ===`);
    for (const m of metrics) {
      console.log(`  ${m.statDate.toISOString().split('T')[0]} | spend=¥${m.spend} | imp=${m.impressions} | cv=${m.conversions}`);
    }
  }

  // SNS_3のLP2-CR00047でも
  const ad3 = await p.ad.findFirst({ where: { name: { contains: 'SNSまとめ（直近勝ち）/LP2-CR00047' } } });
  if (ad3) {
    const metrics = await p.metric.findMany({
      where: { adId: ad3.id, statDate: { gte: new Date('2026-03-14'), lte: new Date('2026-03-22') } },
      orderBy: { statDate: 'asc' },
    });
    console.log(`\n=== SNS_3 LP2-CR00047 (${ad3.tiktokId}) ===`);
    for (const m of metrics) {
      console.log(`  ${m.statDate.toISOString().split('T')[0]} | spend=¥${m.spend} | imp=${m.impressions} | cv=${m.conversions}`);
    }
  }

  await p.$disconnect();
}
main();
