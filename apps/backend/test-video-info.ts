import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testVideoInfo() {
  console.log('🔍 動画情報を確認中...\n');

  const tiktokAdvertiserId = '7247073333517238273';
  const videoId = 'v10033g50000d48o46fog65jhjurn4r0'; // テスト動画ID

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: tiktokAdvertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found');
    await prisma.$disconnect();
    return;
  }

  console.log('✅ アクセストークン取得成功\n');

  try {
    // TikTok APIから動画情報を取得
    console.log('📡 TikTok APIから動画情報を取得中...\n');

    const response = await axios.get(
      'https://business-api.tiktok.com/open_api/v1.3/file/video/ad/info/',
      {
        params: {
          advertiser_id: tiktokAdvertiserId,
          video_ids: `["${videoId}"]`,
        },
        headers: {
          'Access-Token': token.accessToken,
        },
      }
    );

    console.log('✅ 動画情報取得成功\n');
    console.log('📊 レスポンス:');
    console.log('─'.repeat(80));
    console.log(JSON.stringify(response.data, null, 2));
    console.log('─'.repeat(80));

    if (response.data.data?.list && response.data.data.list.length > 0) {
      const video = response.data.data.list[0];
      console.log('\n💡 動画詳細:');
      console.log(`Video ID: ${video.video_id}`);
      console.log(`Width: ${video.width}`);
      console.log(`Height: ${video.height}`);
      console.log(`Duration: ${video.duration}`);
      console.log(`Poster URL: ${video.poster_url || 'なし'}`);
      console.log(`Material ID: ${video.material_id || 'なし'}`);

      if (video.cover_image_uri || video.poster_url) {
        console.log('\n🎨 サムネイル情報が見つかりました！');
      }
    }

  } catch (error: any) {
    console.log('❌ エラー発生\n');
    if (error.response?.data) {
      console.log('レスポンスデータ:');
      console.log('─'.repeat(80));
      console.log(JSON.stringify(error.response.data, null, 2));
      console.log('─'.repeat(80));
    } else {
      console.log('エラーメッセージ:', error.message);
    }
  }

  await prisma.$disconnect();
}

testVideoInfo().catch(console.error);
