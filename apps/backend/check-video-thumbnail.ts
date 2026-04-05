import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function checkVideoThumbnail() {
  console.log('🎬 動画のサムネイル情報を確認中...\n');

  const tiktokAdvertiserId = '7247073333517238273';
  const videoId = 'v10033g50000d48o46fog65jhjurn4r0'; // テスト動画のID

  // DBから動画情報を取得
  const video = await prisma.creative.findFirst({
    where: { tiktokVideoId: videoId },
  });

  if (video) {
    console.log('📊 DB保存情報:');
    console.log(`  Name: ${video.name}`);
    console.log(`  Video ID: ${video.tiktokVideoId}`);
    console.log(`  Image ID: ${video.tiktokImageId}`);
    console.log('');
  }

  // TikTok APIから動画情報を取得
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: tiktokAdvertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found');
    await prisma.$disconnect();
    return;
  }

  try {
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
    console.log('📊 TikTok APIレスポンス:');
    console.log('─'.repeat(80));
    console.log(JSON.stringify(response.data, null, 2));
    console.log('─'.repeat(80));

    if (response.data.data?.list && response.data.data.list.length > 0) {
      const video = response.data.data.list[0];
      console.log('\n💡 動画詳細:');
      console.log(`  Video ID: ${video.video_id}`);
      console.log(`  Width: ${video.width}`);
      console.log(`  Height: ${video.height}`);
      console.log(`  Duration: ${video.duration}s`);
      console.log(`  Format: ${video.format}`);
      console.log(`  Video Cover URL: ${video.video_cover_url}`);

      // 重要: サムネイル画像IDがあるかチェック
      if (video.poster_url) {
        console.log(`  Poster URL: ${video.poster_url}`);
      }
      if (video.cover_image_id) {
        console.log(`  ✅ Cover Image ID: ${video.cover_image_id}`);
      }
      if (video.image_id) {
        console.log(`  ✅ Image ID: ${video.image_id}`);
      }

      console.log('\n📋 全フィールド:');
      Object.keys(video).forEach(key => {
        if (key.toLowerCase().includes('image') || key.toLowerCase().includes('cover') || key.toLowerCase().includes('poster') || key.toLowerCase().includes('thumbnail')) {
          console.log(`  ${key}: ${video[key]}`);
        }
      });
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

checkVideoThumbnail().catch(console.error);
