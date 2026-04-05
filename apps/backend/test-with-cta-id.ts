import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testWithCtaId() {
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

  console.log('広告の call_to_action_id:', currentAd.call_to_action_id);
  console.log('');

  console.log('=== テスト: v1.3 API with call_to_action_id ===\n');

  const creatives: any = {
    ad_id: currentAd.ad_id,
    ad_name: currentAd.ad_name,
    ad_text: currentAd.ad_text,
    ad_format: currentAd.ad_format,
    video_id: currentAd.video_id,
    image_ids: currentAd.image_ids || [],
    landing_page_url: currentAd.landing_page_url,
    identity_id: currentAd.identity_id,
    identity_type: currentAd.identity_type,
  };

  // call_to_action_id がある場合のみ追加
  if (currentAd.call_to_action_id) {
    creatives.call_to_action_id = currentAd.call_to_action_id;
  }

  const body = {
    advertiser_id: advertiserId,
    ad_id: adId,
    adgroup_id: adgroupId,
    ad_name: currentAd.ad_name,
    ad_text: currentAd.ad_text,
    operation_status: 'DISABLE',
    creatives: [creatives],
  };

  console.log('リクエストボディ（creatives部分）:');
  console.log(JSON.stringify(body.creatives, null, 2));
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
      console.log('');
      console.log('TikTok広告マネージャーで広告が停止されているか確認してください！');
    } else {
      console.log('❌ エラー:');
      console.log(JSON.stringify(response.data, null, 2));
    }
  } catch (error: any) {
    console.log('❌ リクエストエラー:');
    console.log(JSON.stringify(error.response?.data || error.message, null, 2));
  }

  await prisma.$disconnect();
}

testWithCtaId().catch(console.error);
