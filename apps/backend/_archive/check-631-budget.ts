import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const ADV = '7543540100849156112';
const AG_ID = '1861071087963282';

async function main() {
  // Smart+広告グループとして取得
  const spResp = await fetch(`https://business-api.tiktok.com/open_api/v1.3/smart_plus/adgroup/get/?advertiser_id=${ADV}&adgroup_ids=["${AG_ID}"]`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const spData = await spResp.json();
  const spAg = spData.data?.list?.[0];
  if (spAg) {
    console.log('=== Smart+ AdGroup ===');
    console.log('budget:', spAg.budget);
    console.log('budget_mode:', spAg.budget_mode);
  } else {
    console.log('Smart+ adgroup: not found');
  }

  // 通常広告グループとして取得（budget フィールドを除いて試す）
  const agResp = await fetch(`https://business-api.tiktok.com/open_api/v1.3/adgroup/get/?advertiser_id=${ADV}&filtering={"adgroup_ids":["${AG_ID}"]}&fields=["adgroup_id","adgroup_name","budget","budget_mode"]`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const agData = await agResp.json();
  console.log('\n=== Normal AdGroup API ===');
  console.log(JSON.stringify(agData, null, 2));

  // DB BudgetLog
  const prisma = new PrismaClient();
  const logs = await prisma.budgetLog.findMany({
    where: { ad: { name: { contains: 'CR00631' } } },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: { createdAt: true, previousBudget: true, newBudget: true, action: true, reason: true, ad: { select: { name: true } } },
  });
  console.log('\n=== Budget Logs (DB) ===');
  for (const l of logs) {
    const jst = new Date(l.createdAt.getTime() + 9 * 3600000);
    console.log(`${jst.toISOString().slice(0, 16)} | ¥${l.previousBudget} → ¥${l.newBudget} | ${l.action} | ${l.reason?.slice(0, 80)}`);
  }

  // AdのDB情報
  const ads = await prisma.ad.findMany({
    where: { name: { contains: 'CR00631' } },
    select: { tiktokId: true, name: true, status: true, adGroup: { select: { budget: true, tiktokId: true } } },
  });
  console.log('\n=== Ad DB Info ===');
  for (const ad of ads) {
    console.log(`${ad.tiktokId} | ${ad.status} | adgroup_budget: ¥${ad.adGroup.budget} | ${ad.name}`);
  }

  await prisma.$disconnect();
}
main();
