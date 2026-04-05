import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testWithAdgroup() {
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

  console.log('=== テスト: advertiser_id + ad_id + adgroup_id + operation_status のみ ===\n');

  const body = {
    advertiser_id: advertiserId,
    ad_id: adId,
    adgroup_id: adgroupId,
    operation_status: 'DISABLE',
  };

  console.log('リクエストボディ:');
  console.log(JSON.stringify(body, null, 2));
  console.log('');

  try {
    const response = await axios.post(
      'https://business-api.tiktok.com/open_api/v1.2/ad/update/',
      body,
      {
        headers: {
          'Access-Token': token.accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('レスポンス:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('');

    if (response.data.code === 0) {
      console.log('✅ 広告停止成功！');
    } else {
      console.log('❌ エラー（code != 0）');
    }
  } catch (error: any) {
    console.log('❌ リクエストエラー:');
    console.log(JSON.stringify(error.response?.data || error.message, null, 2));
  }

  await prisma.$disconnect();
}

testWithAdgroup().catch(console.error);
