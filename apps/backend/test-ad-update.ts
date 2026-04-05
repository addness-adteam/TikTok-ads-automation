import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testAdUpdate() {
  const advertiserId = '7247073333517238273';

  // アクセストークンを取得
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId },
  });

  if (!token) {
    console.error('Access token not found');
    return;
  }

  // 前回のログに出ていた広告ID（停止に失敗していた広告）
  const adId = '1847937633023249';

  console.log('=== Step 1: 広告情報を取得 ===\n');

  try {
    const response = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
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

    const ad = response.data.data?.list?.[0];

    if (ad) {
      console.log('広告情報取得成功:');
      console.log(`  Ad ID: ${ad.ad_id}`);
      console.log(`  Ad Name: ${ad.ad_name}`);
      console.log(`  Status: ${ad.operation_status}`);
      console.log(`  Ad Text: ${ad.ad_text}`);
      console.log(`  Call to Action: ${ad.call_to_action}`);
      console.log(`  Video ID: ${ad.video_id || 'N/A'}`);
      console.log(`  Creatives: ${JSON.stringify(ad.creatives || 'N/A')}`);
      console.log('');

      // 現在のステータスを確認
      if (ad.operation_status === 'DISABLE') {
        console.log('⚠️  この広告はすでに停止されています。');
        console.log('');
      } else if (ad.operation_status === 'ENABLE') {
        console.log('✅ この広告は配信中です。');
        console.log('');
        console.log('=== Step 2: 広告停止のテスト（DRY RUN） ===\n');
        console.log('次のリクエストボディで広告を停止します:');

        const updateBody = {
          advertiser_id: advertiserId,
          ad_id: adId,
          ad_name: ad.ad_name,
          ad_text: ad.ad_text,
          operation_status: 'DISABLE',
        };

        // クリエイティブ情報を含める
        if (ad.creatives && ad.creatives.length > 0) {
          updateBody['creatives'] = ad.creatives;
        }

        if (ad.video_id) {
          updateBody['video_id'] = ad.video_id;
        }

        if (ad.image_ids && ad.image_ids.length > 0) {
          updateBody['image_ids'] = ad.image_ids;
        }

        if (ad.call_to_action) {
          updateBody['call_to_action'] = ad.call_to_action;
        }

        if (ad.landing_page_url) {
          updateBody['landing_page_url'] = ad.landing_page_url;
        }

        console.log(JSON.stringify(updateBody, null, 2));
        console.log('');
        console.log('⚠️  実際に停止する場合は、以下のコメントを外してください。');
        console.log('');

        // 実際に停止する場合は、以下のコメントを外す
        /*
        console.log('=== Step 3: 実際に広告を停止 ===\n');

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

        console.log('広告停止レスポンス:');
        console.log(JSON.stringify(updateResponse.data, null, 2));
        */
      }
    } else {
      console.log('広告が見つかりませんでした。');
    }
  } catch (error) {
    console.error('エラー:', error.response?.data || error.message);
  }

  await prisma.$disconnect();
}

testAdUpdate().catch(console.error);
