import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  const prisma = new PrismaClient();

  // CR00631関連のAd
  const ads = await prisma.ad.findMany({
    where: { name: { contains: 'CR00631' } },
    select: { id: true, tiktokId: true, name: true, status: true, adGroup: { select: { id: true, budget: true, tiktokId: true, campaign: { select: { advertiser: { select: { name: true } } } } } } },
  });
  console.log('=== CR00631 広告 ===');
  for (const ad of ads) {
    console.log(`${ad.adGroup.campaign.advertiser.name} | ${ad.tiktokId} | ${ad.status} | adgroup_budget: ¥${ad.adGroup.budget} | ${ad.name}`);
  }

  // 予算変更ログ（BudgetAdjustmentLogを探す）
  // テーブル名を確認
  const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%budget%' OR table_name LIKE '%log%'` as any[];
  console.log('\n=== Budget/Log テーブル ===');
  for (const t of tables) console.log('  ' + t.table_name);

  await prisma.$disconnect();
}
main();
