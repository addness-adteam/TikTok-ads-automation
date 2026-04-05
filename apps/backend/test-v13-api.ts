import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testV13Api() {
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

  console.log('=== テスト: v1.3 API で広告更新 ===\n');

  const body = {
    advertiser_id: advertiserId,
    ad_id: adId,
    adgroup_id: adgroupId,
    ad_name: currentAd.ad_name,
    ad_text: currentAd.ad_text,
    operation_status: 'DISABLE',
    creatives: [{
      ad_id: currentAd.ad_id,
      ad_name: currentAd.ad_name,
      ad_text: currentAd.ad_text,
      ad_format: currentAd.ad_format,
      video_id: currentAd.video_id,
      image_ids: currentAd.image_ids || [],
      landing_page_url: currentAd.landing_page_url,
    }],
  };

  console.log('リクエストボディ（一部）:');
  console.log(JSON.stringify({
    advertiser_id: body.advertiser_id,
    ad_id: body.ad_id,
    adgroup_id: body.adgroup_id,
    operation_status: body.operation_status,
    creatives: body.creatives,
  }, null, 2));
  console.log('');

  try {
    const response = await axios.post(
      'https://business-api.tiktok.com/open_api/v1.3/ad/update/',
      body,
      {
        headers: {
          'Access-Token': token.accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('レスポンス: code=' + response.data.code + ', message="' + response.data.message + '"');
    console.log('');

    if (response.data.code === 0) {
      console.log('🎉🎉🎉 成功！広告停止できました！🎉🎉🎉');
    } else {
      console.log('完全なレスポンス:');
      console.log(JSON.stringify(response.data, null, 2));
    }
  } catch (error: any) {
    console.log('❌ リクエストエラー:');
    if (error.response?.status === 404) {
      console.log('v1.3/ad/update/ エンドポイントが存在しません (404)');
      console.log('v1.2 APIを使用する必要があります。');
    } else {
      console.log(JSON.stringify(error.response?.data || error.message, null, 2));
    }
  }

  await prisma.$disconnect();
}

testV13Api().catch(console.error);
