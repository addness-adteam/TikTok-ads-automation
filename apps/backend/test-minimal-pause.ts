import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testMinimalPause() {
  const advertiserId = '7247073333517238273';
  const adId = '1847937633023249';
  const adgroupId = '1847937254223089';

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found');
    return;
  }

  // 現在の広告情報を取得
  const getResponse = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
    headers: {
      'Access-Token': token.accessToken,
    },
    params: {
      advertiser_id: advertiserId,
      filtering: JSON.stringify({
        ad_ids: [adId],
      }),
    },
  });

  const currentAd = getResponse.data.data?.list?.[0];

  if (!currentAd) {
    console.error('❌ 広告が見つかりませんでした');
    return;
  }

  console.log(`現在のステータス: ${currentAd.operation_status}\n`);

  if (currentAd.operation_status === 'DISABLE') {
    console.log('⚠️  この広告はすでに停止されています。');
    await prisma.$disconnect();
    return;
  }

  console.log('=== テスト1: 最小限のフィールドのみ ===\n');

  const minimalBody = {
    advertiser_id: advertiserId,
    ad_id: adId,
    operation_status: 'DISABLE',
  };

  console.log('リクエストボディ:');
  console.log(JSON.stringify(minimalBody, null, 2));
  console.log('');

  try {
    const response1 = await axios.post(
      'https://business-api.tiktok.com/open_api/v1.2/ad/update/',
      minimalBody,
      {
        headers: {
          'Access-Token': token.accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ 成功！');
    console.log(JSON.stringify(response1.data, null, 2));
  } catch (error: any) {
    console.log('❌ エラー:');
    console.log(error.response?.data || error.message);
    console.log('');

    console.log('=== テスト2: adgroup_id を追加 ===\n');

    const withAdgroupBody = {
      advertiser_id: advertiserId,
      ad_id: adId,
      adgroup_id: adgroupId,
      operation_status: 'DISABLE',
    };

    console.log('リクエストボディ:');
    console.log(JSON.stringify(withAdgroupBody, null, 2));
    console.log('');

    try {
      const response2 = await axios.post(
        'https://business-api.tiktok.com/open_api/v1.2/ad/update/',
        withAdgroupBody,
        {
          headers: {
            'Access-Token': token.accessToken,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('✅ 成功！');
      console.log(JSON.stringify(response2.data, null, 2));
    } catch (error2: any) {
      console.log('❌ エラー:');
      console.log(error2.response?.data || error2.message);
    }
  }

  await prisma.$disconnect();
}

testMinimalPause().catch(console.error);
