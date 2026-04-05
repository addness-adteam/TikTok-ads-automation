import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, 'apps/backend/.env') });

const prisma = new PrismaClient();

async function main() {
  const h = await prisma.hypothesisTest.create({
    data: {
      channelType: 'AI',
      hypothesis: 'CR01065をAI_2に横展開。AI_3で個別予約CPO ¥22,615なのでAI_2でも同等の成績が出るはず',
      status: 'RUNNING',
      adId: '1860419942288418',
      adName: '260323/鈴木織大/尻込み_ちえみさん/LP1-CR01094',
      account: 'アドネス株式会社_AI_2',
    },
  });
  console.log('登録完了:', h.id);

  const all = await prisma.hypothesisTest.findMany();
  console.log('全件数:', all.length);
  for (const r of all) {
    console.log(`  ${r.id}: ${r.status} | ${r.adName} | ${r.hypothesis.substring(0, 50)}...`);
  }
  await prisma.$disconnect();
}
main();
