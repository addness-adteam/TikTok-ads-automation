// 既存AdGroupのinitialBudgetをbudget（現在の日予算）で埋める
// ※ 既に予算調整で変動している可能性があるので、チャネル別デフォルト予算をセット
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// チャネル別デフォルト日予算
const DEFAULT_BUDGETS: Record<string, number> = {
  AI: 3000,
  SNS: 3000,
  SEMINAR: 5000,
};

// アカウント→チャネルマッピング
const ACCOUNT_CHANNEL: Record<string, string> = {
  '7468288053866561553': 'AI',     // AI_1
  '7523128243466551303': 'AI',     // AI_2
  '7543540647266074641': 'AI',     // AI_3
  '7580666710525493255': 'AI',     // AI_4
  '7474920444831875080': 'SEMINAR', // SP1
  '7592868952431362066': 'SEMINAR', // SP2
  '7247073333517238273': 'SNS',    // SNS1
  '7543540100849156112': 'SNS',    // SNS2
  '7543540381615800337': 'SNS',    // SNS3
};

async function main() {
  // アカウントごとにAdGroupのinitialBudgetをデフォルト予算でバックフィル
  const advertisers = await prisma.advertiser.findMany({
    include: { appeal: true },
  });

  let updated = 0;
  for (const adv of advertisers) {
    const channel = ACCOUNT_CHANNEL[adv.tiktokAdvertiserId];
    if (!channel) continue;

    const defaultBudget = DEFAULT_BUDGETS[channel];
    const campaigns = await prisma.campaign.findMany({
      where: { advertiserId: adv.id },
      select: { id: true },
    });
    if (campaigns.length === 0) continue;

    const result = await prisma.adGroup.updateMany({
      where: {
        campaignId: { in: campaigns.map(c => c.id) },
        initialBudget: null,
      },
      data: { initialBudget: defaultBudget },
    });

    if (result.count > 0) {
      console.log(`${adv.name}: ${result.count}件のAdGroupにinitialBudget=¥${defaultBudget}をセット`);
      updated += result.count;
    }
  }

  // 上記に該当しなかったAdGroup（他アカウント）は現在のbudgetで埋める
  const remaining = await prisma.adGroup.findMany({
    where: { initialBudget: null, budget: { not: null } },
    select: { id: true, budget: true },
  });

  for (const ag of remaining) {
    await prisma.adGroup.update({
      where: { id: ag.id },
      data: { initialBudget: ag.budget },
    });
    updated++;
  }
  if (remaining.length > 0) {
    console.log(`その他: ${remaining.length}件のAdGroupにinitialBudget=現在予算をセット`);
  }

  console.log(`\n合計: ${updated}件更新`);

  // 確認
  const filled = await prisma.adGroup.count({ where: { initialBudget: { not: null } } });
  const total = await prisma.adGroup.count();
  console.log(`initialBudget filled: ${filled}/${total}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
