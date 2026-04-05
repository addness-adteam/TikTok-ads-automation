import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function find916Images() {
  console.log('🔍 9:16のサムネイル画像を探しています...\n');

  const tiktokAdvertiserId = '7247073333517238273';

  // DBからすべての画像を取得
  const images = await prisma.creative.findMany({
    where: { type: 'IMAGE' },
    orderBy: { createdAt: 'desc' },
  });

  if (images.length === 0) {
    console.log('⚠️  画像Creativeが見つかりません\n');
    await prisma.$disconnect();
    return;
  }

  console.log(`📊 画像Creative ${images.length}件を確認中...\n`);

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: tiktokAdvertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found');
    await prisma.$disconnect();
    return;
  }

  const imageIds = images.map(img => img.tiktokImageId).filter(id => id !== null);

  try {
    const response = await axios.get(
      'https://business-api.tiktok.com/open_api/v1.3/file/image/ad/info/',
      {
        params: {
          advertiser_id: tiktokAdvertiserId,
          image_ids: JSON.stringify(imageIds),
        },
        headers: {
          'Access-Token': token.accessToken,
        },
      }
    );

    if (response.data.data?.list && response.data.data.list.length > 0) {
      console.log('✅ 画像情報取得成功\n');

      const suitable916Images: any[] = [];
      const otherImages: any[] = [];

      response.data.data.list.forEach((img: any) => {
        const aspectRatio = img.width / img.height;
        const is916 = Math.abs(aspectRatio - (9/16)) < 0.01;

        if (is916) {
          suitable916Images.push(img);
        } else {
          otherImages.push(img);
        }
      });

      if (suitable916Images.length > 0) {
        console.log('🎉 9:16の画像が見つかりました！\n');
        suitable916Images.forEach((img, i) => {
          console.log(`${i + 1}. Image ID: ${img.image_id}`);
          console.log(`   サイズ: ${img.width}x${img.height}`);
          console.log(`   アスペクト比: 9:16 ✅`);
          console.log(`   Format: ${img.format}`);
          console.log(`   Size: ${img.size} bytes`);
          console.log('');
        });

        console.log('💡 上記の画像IDを動画広告のサムネイルとして使用できます！');
      } else {
        console.log('❌ 9:16の画像が見つかりませんでした\n');
        console.log('📋 利用可能な画像のアスペクト比:');
        otherImages.forEach((img, i) => {
          const aspectRatio = img.width / img.height;
          const aspectRatioStr = aspectRatio > 1 ? `${aspectRatio.toFixed(2)}:1 (横長)`
                               : aspectRatio < 1 ? `${(1/aspectRatio).toFixed(2)}:1 (縦長)`
                               : '1:1 (正方形)';
          console.log(`  ${i + 1}. ${img.width}x${img.height} = ${aspectRatioStr}`);
        });

        console.log('\n💡 解決策:');
        console.log('  1. 9:16（縦長）の画像を新規アップロードする');
        console.log('  2. または、動画のフレームから9:16の画像を生成する');
      }
    }

  } catch (error: any) {
    console.log('❌ エラー発生\n');
    if (error.response?.data) {
      console.log('レスポンスデータ:');
      console.log(JSON.stringify(error.response.data, null, 2));
    } else {
      console.log('エラーメッセージ:', error.message);
    }
  }

  await prisma.$disconnect();
}

find916Images().catch(console.error);
