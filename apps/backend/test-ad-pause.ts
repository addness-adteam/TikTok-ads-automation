import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testAdPause() {
  const advertiserId = '7247073333517238273';
  const adId = '1847937633023249';
  const adgroupId = '1847937254223089';

  console.log('=== Step 1: 現在の広告ステータスを確認 ===\n');

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

  console.log('=== Step 2: 広告停止リクエストを送信 ===\n');

  // 停止リクエストボディを構築
  const updateBody: any = {
    advertiser_id: advertiserId,
    ad_id: adId,
    adgroup_id: adgroupId,
    ad_name: currentAd.ad_name,
    ad_text: currentAd.ad_text,
    operation_status: 'DISABLE',
  };

  // クリエイティブ情報を構築
  updateBody.creatives = [{
    ad_id: currentAd.ad_id,
    ad_name: currentAd.ad_name,
    ad_text: currentAd.ad_text,
    ad_format: currentAd.ad_format,
    video_id: currentAd.video_id,
    image_ids: currentAd.image_ids || [],
    landing_page_url: currentAd.landing_page_url,
    call_to_action: currentAd.call_to_action,
  }];

  // その他のフィールド
  if (currentAd.video_id) {
    updateBody.video_id = currentAd.video_id;
  }

  if (currentAd.image_ids && currentAd.image_ids.length > 0) {
    updateBody.image_ids = currentAd.image_ids;
  }

  if (currentAd.call_to_action !== undefined && currentAd.call_to_action !== null) {
    updateBody.call_to_action = currentAd.call_to_action;
  }

  if (currentAd.landing_page_url) {
    updateBody.landing_page_url = currentAd.landing_page_url;
  }

  console.log('送信するリクエストボディ:');
  console.log(JSON.stringify(updateBody, null, 2));
  console.log('');

  try {
    const updateResponse = await axios.post(
      'https://business-api.tiktok.com/open_api/v1.2/ad/update/',
      updateBody,
      {
        headers: {
          'Access-Token': token.accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('=== Step 3: レスポンス確認 ===\n');
    console.log('レスポンスコード:', updateResponse.data.code);
    console.log('レスポンスメッセージ:', updateResponse.data.message);
    console.log('');

    if (updateResponse.data.code === 0) {
      console.log('✅ 広告停止成功！');
      console.log('');
      console.log('TikTok広告マネージャーで広告が停止されているか確認してください。');
    } else {
      console.log('❌ エラー発生:');
      console.log(JSON.stringify(updateResponse.data, null, 2));
    }
  } catch (error: any) {
    console.error('❌ エラー発生:');
    console.error(error.response?.data || error.message);
  }

  await prisma.$disconnect();
}

testAdPause().catch(console.error);
