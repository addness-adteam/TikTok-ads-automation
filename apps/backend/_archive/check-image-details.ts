import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function checkImageDetails() {
  console.log('🔍 サムネイル画像の詳細を確認中...\n');

  const tiktokAdvertiserId = '7247073333517238273';
  const imageId = 'ad-site-i18n-sg/20251110c7c770eaa4a1515d4866a14e'; // テストで使用したサムネイル画像ID

  // DBから画像情報を取得
  const image = await prisma.creative.findFirst({
    where: { tiktokImageId: imageId },
  });

  if (image) {
    console.log('📊 DB保存情報:');
    console.log(`  Name: ${image.name}`);
    console.log(`  Width: ${image.width}`);
    console.log(`  Height: ${image.height}`);
    console.log(`  Size: ${image.fileSize} bytes`);

    if (image.width && image.height) {
      const aspectRatio = image.width / image.height;
      const aspectRatioStr = aspectRatio > 1 ? `${aspectRatio.toFixed(2)}:1 (横長)`
                           : aspectRatio < 1 ? `${(1/aspectRatio).toFixed(2)}:1 (縦長)`
                           : '1:1 (正方形)';
      console.log(`  アスペクト比: ${aspectRatioStr}`);
    }
    console.log('');
  } else {
    console.log('⚠️  DBに画像情報が見つかりません\n');
  }

  // TikTok APIから画像情報を取得
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: tiktokAdvertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found');
    await prisma.$disconnect();
    return;
  }

  try {
    console.log('📡 TikTok APIから画像情報を取得中...\n');

    const response = await axios.get(
      'https://business-api.tiktok.com/open_api/v1.3/file/image/ad/info/',
      {
        params: {
          advertiser_id: tiktokAdvertiserId,
          image_ids: `["${imageId}"]`,
        },
        headers: {
          'Access-Token': token.accessToken,
        },
      }
    );

    console.log('✅ 画像情報取得成功\n');
    console.log('📊 TikTok APIレスポンス:');
    console.log('─'.repeat(80));
    console.log(JSON.stringify(response.data, null, 2));
    console.log('─'.repeat(80));

    if (response.data.data?.list && response.data.data.list.length > 0) {
      const img = response.data.data.list[0];
      console.log('\n💡 画像詳細:');
      console.log(`  Image ID: ${img.image_id}`);
      console.log(`  Width: ${img.width}`);
      console.log(`  Height: ${img.height}`);
      console.log(`  Size: ${img.size} bytes`);
      console.log(`  Format: ${img.format}`);

      const aspectRatio = img.width / img.height;
      const aspectRatioStr = aspectRatio > 1 ? `${aspectRatio.toFixed(2)}:1 (横長)`
                           : aspectRatio < 1 ? `${(1/aspectRatio).toFixed(2)}:1 (縦長)`
                           : '1:1 (正方形)';
      console.log(`  アスペクト比: ${aspectRatioStr}`);

      console.log('\n🎬 動画との比較:');
      console.log(`  動画: 1080x1920 = 9:16 (縦長)`);
      console.log(`  画像: ${img.width}x${img.height} = ${aspectRatioStr}`);

      if (Math.abs(aspectRatio - (9/16)) < 0.01) {
        console.log('  ✅ アスペクト比が一致しています！');
      } else {
        console.log('  ❌ アスペクト比が一致していません！');
        console.log(`  💡 動画に合わせて9:16（縦長）の画像が必要です`);
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

checkImageDetails().catch(console.error);
