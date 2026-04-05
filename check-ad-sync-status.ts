// 広告の同期状況を確認するスクリプト
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAdSyncStatus() {
  console.log('=== 広告の同期状況の確認 ===\n');

  // 全広告主の広告数を確認
  const campaigns = await prisma.campaign.findMany({
    select: {
      advertiserId: true,
      id: true,
    },
    distinct: ['advertiserId'],
  });

  const advertiserIds = [...new Set(campaigns.map((c) => c.advertiserId))];

  console.log(`データベース内の広告主数: ${advertiserIds.length}\n`);

  for (const advId of advertiserIds) {
    const campaignCount = await prisma.campaign.count({
      where: { advertiserId: advId },
    });

    const adgroupCount = await prisma.adGroup.count({
      where: {
        campaign: {
          advertiserId: advId,
        },
      },
    });

    const adCount = await prisma.ad.count({
      where: {
        adGroup: {
          campaign: {
            advertiserId: advId,
          },
        },
      },
    });

    // この広告主のOAuthトークンを確認
    const token = await prisma.oAuthToken.findFirst({
      where: { advertiserId: advId },
    });

    console.log(`広告主: ${advId}`);
    console.log(`  トークン: ${token ? '✅ あり' : '❌ なし'}`);
    console.log(`  キャンペーン数: ${campaignCount}`);
    console.log(`  広告グループ数: ${adgroupCount}`);
    console.log(`  広告数: ${adCount}`);
    console.log();
  }

  // AI導線とSNS導線の広告数を確認
  console.log('=== 訴求別の広告数 ===\n');

  const aiAdCount = await prisma.ad.count({
    where: {
      name: {
        contains: 'AI',
      },
    },
  });

  const snsAdCount = await prisma.ad.count({
    where: {
      name: {
        contains: 'SNS',
      },
    },
  });

  console.log(`AI導線の広告数: ${aiAdCount}`);
  console.log(`SNS導線の広告数: ${snsAdCount}\n`);

  // 最近更新された広告を確認
  console.log('=== 最近更新された広告 ===\n');

  const recentAds = await prisma.ad.findMany({
    orderBy: {
      updatedAt: 'desc',
    },
    take: 10,
    select: {
      name: true,
      tiktokId: true,
      status: true,
      updatedAt: true,
      adGroup: {
        select: {
          campaign: {
            select: {
              advertiserId: true,
            },
          },
        },
      },
    },
  });

  recentAds.forEach((ad) => {
    console.log(`広告: ${ad.name}`);
    console.log(`  TikTok ID: ${ad.tiktokId}`);
    console.log(`  ステータス: ${ad.status}`);
    console.log(`  最終更新: ${ad.updatedAt.toISOString()}`);
    console.log(`  広告主ID: ${ad.adGroup.campaign.advertiserId}`);
    console.log();
  });

  // エンティティ同期のジョブ実行状況を確認
  console.log('=== 問題の可能性 ===\n');

  console.log('もし広告数が少ない、または最終更新が古い場合：');
  console.log('1. エンティティ同期ジョブが正しく実行されていない');
  console.log('2. TikTok APIからの広告取得に失敗している');
  console.log('3. OAuthトークンが期限切れまたは無効\n');

  console.log('次のステップ:');
  console.log('1. GitHub Actionsのログで「Ad not found in DB」を検索');
  console.log('2. エンティティ同期ジョブを手動実行: POST /jobs/sync-entities');
  console.log('3. TikTok APIから広告リストを取得できるか確認');

  await prisma.$disconnect();
}

checkAdSyncStatus().catch((error) => {
  console.error(error);
  process.exit(1);
});
