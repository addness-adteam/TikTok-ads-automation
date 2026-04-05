import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testFindIdentityError() {
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

  // テスト1: ad_id + video_id + ad_format
  console.log('=== テスト1: ad_id + video_id + ad_format ===\n');
  const body1 = {
    advertiser_id: advertiserId,
    ad_id: adId,
    adgroup_id: adgroupId,
    operation_status: 'DISABLE',
    creatives: [{
      ad_id: currentAd.ad_id,
      video_id: currentAd.video_id,
      ad_format: currentAd.ad_format,
    }],
  };

  const success1 = await testRequest(token.accessToken, body1, 'Test 1');
  if (success1) return;

  // テスト2: + ad_name
  console.log('=== テスト2: + ad_name ===\n');
  const body2 = {
    advertiser_id: advertiserId,
    ad_id: adId,
    adgroup_id: adgroupId,
    operation_status: 'DISABLE',
    creatives: [{
      ad_id: currentAd.ad_id,
      ad_name: currentAd.ad_name,
      video_id: currentAd.video_id,
      ad_format: currentAd.ad_format,
    }],
  };

  const success2 = await testRequest(token.accessToken, body2, 'Test 2');
  if (success2) return;

  // テスト3: + ad_text
  console.log('=== テスト3: + ad_text ===\n');
  const body3 = {
    advertiser_id: advertiserId,
    ad_id: adId,
    adgroup_id: adgroupId,
    operation_status: 'DISABLE',
    creatives: [{
      ad_id: currentAd.ad_id,
      ad_name: currentAd.ad_name,
      ad_text: currentAd.ad_text,
      video_id: currentAd.video_id,
      ad_format: currentAd.ad_format,
    }],
  };

  const success3 = await testRequest(token.accessToken, body3, 'Test 3');
  if (success3) return;

  // テスト4: + image_ids
  console.log('=== テスト4: + image_ids ===\n');
  const body4 = {
    advertiser_id: advertiserId,
    ad_id: adId,
    adgroup_id: adgroupId,
    operation_status: 'DISABLE',
    creatives: [{
      ad_id: currentAd.ad_id,
      ad_name: currentAd.ad_name,
      ad_text: currentAd.ad_text,
      video_id: currentAd.video_id,
      ad_format: currentAd.ad_format,
      image_ids: currentAd.image_ids || [],
    }],
  };

  const success4 = await testRequest(token.accessToken, body4, 'Test 4');
  if (success4) return;

  // テスト5: + landing_page_url
  console.log('=== テスト5: + landing_page_url ===\n');
  const body5 = {
    advertiser_id: advertiserId,
    ad_id: adId,
    adgroup_id: adgroupId,
    operation_status: 'DISABLE',
    creatives: [{
      ad_id: currentAd.ad_id,
      ad_name: currentAd.ad_name,
      ad_text: currentAd.ad_text,
      video_id: currentAd.video_id,
      ad_format: currentAd.ad_format,
      image_ids: currentAd.image_ids || [],
      landing_page_url: currentAd.landing_page_url,
    }],
  };

  const success5 = await testRequest(token.accessToken, body5, 'Test 5');
  if (success5) return;

  // テスト6: + call_to_action (これが原因かも？)
  console.log('=== テスト6: + call_to_action ===\n');
  const body6 = {
    advertiser_id: advertiserId,
    ad_id: adId,
    adgroup_id: adgroupId,
    operation_status: 'DISABLE',
    creatives: [{
      ad_id: currentAd.ad_id,
      ad_name: currentAd.ad_name,
      ad_text: currentAd.ad_text,
      video_id: currentAd.video_id,
      ad_format: currentAd.ad_format,
      image_ids: currentAd.image_ids || [],
      landing_page_url: currentAd.landing_page_url,
      call_to_action: currentAd.call_to_action,
    }],
  };

  await testRequest(token.accessToken, body6, 'Test 6');

  await prisma.$disconnect();
}

async function testRequest(accessToken: string, body: any, testName: string): Promise<boolean> {
  console.log(`${testName} creatives:`, JSON.stringify(body.creatives, null, 2));
  console.log('');

  try {
    const response = await axios.post(
      'https://business-api.tiktok.com/open_api/v1.2/ad/update/',
      body,
      {
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`${testName} レスポンス: code=${response.data.code}, message="${response.data.message}"`);

    if (response.data.code === 0) {
      console.log(`\n🎉🎉🎉 ${testName} 成功！広告停止できました！🎉🎉🎉\n`);
      return true;
    } else {
      console.log('');
      return false;
    }
  } catch (error: any) {
    console.log(`❌ ${testName} リクエストエラー:`);
    console.log(error.response?.data || error.message);
    console.log('');
    return false;
  }
}

testFindIdentityError().catch(console.error);
