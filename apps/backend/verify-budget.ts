import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function verifyBudgetChanges() {
  const advertiserId = '7247073333517238273';

  // アクセストークンを取得
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId },
  });

  if (!token) {
    console.error('Access token not found');
    return;
  }

  const adgroupIds = [
    '1847734887734369',
    '1847733488515122',
    '1847733042974753',
  ];

  console.log('=== TikTok API経由で現在の予算を確認 ===\n');

  for (const adgroupId of adgroupIds) {
    try {
      const response = await axios.get('https://business-api.tiktok.com/open_api/v1.3/adgroup/get/', {
        headers: {
          'Access-Token': token.accessToken,
        },
        params: {
          advertiser_id: advertiserId,
          filtering: JSON.stringify({
            adgroup_ids: [adgroupId],
          }),
        },
      });

      const adgroup = response.data.data?.list?.[0];

      if (adgroup) {
        console.log(`AdGroup ID: ${adgroupId}`);
        console.log(`  現在の予算: ${adgroup.budget}円`);
        console.log(`  予算モード: ${adgroup.budget_mode}`);
        console.log(`  ステータス: ${adgroup.operation_status}`);
        console.log('');
      } else {
        console.log(`AdGroup ID: ${adgroupId} - データが見つかりませんでした\n`);
      }
    } catch (error) {
      console.error(`AdGroup ID: ${adgroupId} - エラー:`, error.response?.data || error.message);
      console.log('');
    }
  }

  // 変更履歴も確認
  console.log('=== データベースの変更履歴を確認 ===\n');

  const changeLogs = await prisma.changeLog.findMany({
    where: {
      entityType: 'ADGROUP',
      action: 'UPDATE_BUDGET',
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 10,
  });

  for (const log of changeLogs) {
    console.log(`時刻: ${log.createdAt.toISOString()}`);
    console.log(`AdGroup ID: ${log.entityId}`);
    console.log(`理由: ${log.reason}`);
    console.log(`変更前: ${JSON.stringify(log.beforeData)}`);
    console.log(`変更後: ${JSON.stringify(log.afterData)}`);
    console.log('');
  }

  await prisma.$disconnect();
}

verifyBudgetChanges().catch(console.error);
