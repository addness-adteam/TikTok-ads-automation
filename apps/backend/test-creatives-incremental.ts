import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testCreativesIncremental() {
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

  // テスト1: creativesに video_id のみ
  console.log('=== テスト1: creatives with video_id only ===\n');
  const body1 = {
    advertiser_id: advertiserId,
    ad_id: adId,
    adgroup_id: adgroupId,
    operation_status: 'DISABLE',
    creatives: [{
      video_id: currentAd.video_id,
    }],
  };

  await testRequest(token.accessToken, body1, 'Test 1');

  // テスト2: creativesに ad_format を追加
  console.log('=== テスト2: creatives with video_id + ad_format ===\n');
  const body2 = {
    advertiser_id: advertiserId,
    ad_id: adId,
    adgroup_id: adgroupId,
    operation_status: 'DISABLE',
    creatives: [{
      video_id: currentAd.video_id,
      ad_format: currentAd.ad_format,
    }],
  };

  await testRequest(token.accessToken, body2, 'Test 2');

  // テスト3: creativesに image_ids を追加
  console.log('=== テスト3: + image_ids ===\n');
  const body3 = {
    advertiser_id: advertiserId,
    ad_id: adId,
    adgroup_id: adgroupId,
    operation_status: 'DISABLE',
    creatives: [{
      video_id: currentAd.video_id,
      ad_format: currentAd.ad_format,
      image_ids: currentAd.image_ids || [],
    }],
  };

  await testRequest(token.accessToken, body3, 'Test 3');

  // テスト4: landing_page_url を追加
  console.log('=== テスト4: + landing_page_url ===\n');
  const body4 = {
    advertiser_id: advertiserId,
    ad_id: adId,
    adgroup_id: adgroupId,
    operation_status: 'DISABLE',
    creatives: [{
      video_id: currentAd.video_id,
      ad_format: currentAd.ad_format,
      image_ids: currentAd.image_ids || [],
      landing_page_url: currentAd.landing_page_url,
    }],
  };

  await testRequest(token.accessToken, body4, 'Test 4');

  await prisma.$disconnect();
}

async function testRequest(accessToken: string, body: any, testName: string) {
  console.log(`${testName} リクエストボディ:`);
  console.log(JSON.stringify(body, null, 2));
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

    console.log(`${testName} レスポンス:`, response.data.code, response.data.message);

    if (response.data.code === 0) {
      console.log(`✅ ${testName} 成功！停止できました！\n`);
      return true;
    } else {
      console.log(`❌ ${testName} エラー: ${response.data.message}\n`);
      return false;
    }
  } catch (error: any) {
    console.log(`❌ ${testName} リクエストエラー:`);
    console.log(error.response?.data || error.message);
    console.log('');
    return false;
  }
}

testCreativesIncremental().catch(console.error);
