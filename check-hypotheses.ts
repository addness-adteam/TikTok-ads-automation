import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, 'apps/backend/.env') });
const prisma = new PrismaClient();

async function main() {
  // DB登録済み
  const all = await prisma.hypothesisTest.findMany({ orderBy: { createdAt: 'desc' } });
  console.log(`\n=== DB登録済み仮説: ${all.length}件 ===`);
  for (const r of all) {
    console.log(`  [${r.status}] ${r.adName} (${r.account})`);
    console.log(`    仮説: ${r.hypothesis}`);
    if (r.verdict) console.log(`    結果: ${r.verdict} - ${r.interpretation}`);
    console.log(`    登録: ${r.createdAt.toISOString().split('T')[0]}`);
  }

  // 今日横展開した3本（仮説未登録のもの）
  console.log(`\n=== 今日横展開したが仮説未登録の広告 ===`);
  const todayAds = await prisma.ad.findMany({
    where: {
      name: { startsWith: '260323/' },
      adGroup: { campaign: { advertiser: { tiktokAdvertiserId: '7523128243466551303' } } }, // AI_2
    },
    select: { tiktokId: true, name: true, status: true },
  });
  for (const ad of todayAds) {
    const hasHypothesis = all.some(h => h.adId === ad.tiktokId);
    console.log(`  ${hasHypothesis ? '✅登録済' : '❌未登録'} ${ad.name} (${ad.tiktokId}) [${ad.status}]`);
  }

  await prisma.$disconnect();
}
main();
