import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testAdStatusUpdate() {
  const advertiserId = '7247073333517238273';
  const adId = '1847937633023249';

  console.log('=== 広告ステータス更新API テスト ===\n');

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found');
    return;
  }

  // まず現在のステータスを確認
  console.log('Step 1: 現在の広告ステータスを確認\n');

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

  console.log(`広告ID: ${currentAd.ad_id}`);
  console.log(`広告名: ${currentAd.ad_name}`);
  console.log(`現在のステータス: ${currentAd.operation_status}`);
  console.log('');

  if (currentAd.operation_status === 'DISABLE') {
    console.log('⚠️  この広告はすでに停止されています。');
    console.log('');
    await prisma.$disconnect();
    return;
  }

  // 新しいステータス更新エンドポイントを使用
  console.log('Step 2: 新しいステータス更新エンドポイントで広告を停止\n');

  const statusUpdateBody = {
    advertiser_id: advertiserId,
    ad_ids: [adId],
    operation_status: 'DISABLE',
  };

  console.log('リクエストボディ:');
  console.log(JSON.stringify(statusUpdateBody, null, 2));
  console.log('');

  try {
    const updateResponse = await axios.post(
      'https://business-api.tiktok.com/open_api/v1.3/ad/status/update/',
      statusUpdateBody,
      {
        headers: {
          'Access-Token': token.accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('=== レスポンス ===\n');
    console.log('レスポンスコード:', updateResponse.data.code);
    console.log('レスポンスメッセージ:', updateResponse.data.message);
    console.log('');
    console.log('完全なレスポンス:');
    console.log(JSON.stringify(updateResponse.data, null, 2));
    console.log('');

    if (updateResponse.data.code === 0) {
      console.log('🎉🎉🎉 成功！広告が停止されました！🎉🎉🎉');
      console.log('');
      console.log('TikTok広告マネージャーで広告が停止されているか確認してください。');
    } else {
      console.log('❌ エラー: code !== 0');
    }
  } catch (error: any) {
    console.error('❌ エラー発生:');
    console.error(JSON.stringify(error.response?.data || error.message, null, 2));
  }

  await prisma.$disconnect();
}

testAdStatusUpdate().catch(console.error);
