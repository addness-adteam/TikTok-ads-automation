import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  // Find the ad
  const ad = await prisma.ad.findFirst({
    where: {
      name: { contains: 'LP1-CR00980' },
      adGroup: {
        campaign: {
          advertiser: { tiktokAdvertiserId: '7543540647266074641' }
        }
      }
    },
    include: {
      adGroup: {
        include: {
          campaign: {
            include: { advertiser: true }
          }
        }
      }
    }
  });

  if (!ad) {
    console.log('広告が見つかりませんでした');
    // Search more broadly
    const ads = await prisma.ad.findMany({
      where: {
        name: { contains: 'CR00980' },
      },
      select: { name: true, tiktokId: true },
    });
    console.log('CR00980を含む広告:', ads);
    await prisma.$disconnect();
    return;
  }

  console.log('=== 広告情報 ===');
  console.log('Ad Name:', ad.name);
  console.log('Ad TikTok ID:', ad.tiktokId);
  console.log('Ad Status:', ad.status);
  console.log('AdGroup:', ad.adGroup?.name);
  console.log('AdGroup TikTok ID:', ad.adGroup?.tiktokId);
  console.log('Campaign:', ad.adGroup?.campaign?.name);
  console.log('Campaign Type:', ad.adGroup?.campaign?.objectiveType);
  console.log('Is Smart+:', ad.adGroup?.campaign?.isSmartPlus);

  // Check recent snapshots
  const snapshots = await prisma.hourlyOptimizationSnapshot.findMany({
    where: { adId: ad.tiktokId },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });

  console.log('\n=== 直近の最適化スナップショット ===');
  for (const s of snapshots) {
    console.log(JSON.stringify({
      date: s.createdAt.toISOString(),
      action: s.action,
      dailyBudget: s.dailyBudget,
      newBudget: s.newBudget,
      todaySpend: s.todaySpend,
      todayCV: s.todayCVCount,
      todayCPA: s.todayCPA,
      reason: s.reason,
    }));
  }

  // Also check if it's Smart+
  const campaign = ad.adGroup?.campaign;
  console.log('\n=== キャンペーン詳細 ===');
  console.log('Campaign ID:', campaign?.tiktokId);
  console.log('Campaign Name:', campaign?.name);
  console.log('isSmartPlus:', campaign?.isSmartPlus);
  console.log('objectiveType:', campaign?.objectiveType);
  console.log('budgetMode:', (campaign as any)?.budgetMode);

  // Check today's metrics
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMetrics = await prisma.metric.findMany({
    where: {
      adId: ad.id,
      statDate: { gte: new Date('2026-03-01') },
    },
    orderBy: { statDate: 'desc' },
    take: 5,
  });
  console.log('\n=== 直近のメトリクス ===');
  for (const m of todayMetrics) {
    console.log(JSON.stringify({
      date: m.statDate.toISOString(),
      spend: m.spend,
      conversions: m.conversions,
      impressions: m.impressions,
      clicks: m.clicks,
    }));
  }

  await prisma.$disconnect();
}

main();
