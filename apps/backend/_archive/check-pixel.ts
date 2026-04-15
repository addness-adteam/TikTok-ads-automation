import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function checkPixel() {
  console.log('🔍 Pixel ID確認開始\n');

  const tiktokAdvertiserId = '7247073333517238273';

  // アクセストークン取得
  console.log('📡 DBからアクセストークンを取得中...');
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: tiktokAdvertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found');
    await prisma.$disconnect();
    return;
  }
  console.log('✅ アクセストークン取得成功\n');

  // TikTok APIからPixel一覧を取得
  console.log('🚀 TikTok APIからPixel一覧を取得中...');
  try {
    const response = await axios.get(
      'https://business-api.tiktok.com/open_api/v1.3/pixel/list/',
      {
        params: {
          advertiser_id: tiktokAdvertiserId,
        },
        headers: {
          'Access-Token': token.accessToken,
        },
      }
    );

    console.log('✅ Pixel取得成功\n');
    console.log('📊 レスポンス:');
    console.log(JSON.stringify(response.data, null, 2));

    if (response.data.data?.pixels) {
      console.log('\n📋 利用可能なPixel:');
      response.data.data.pixels.forEach((pixel: any, index: number) => {
        console.log(`\n${index + 1}. ${pixel.pixel_name || 'Unnamed Pixel'}`);
        console.log(`   Pixel ID: ${pixel.pixel_id}`);
        console.log(`   Pixel Code: ${pixel.pixel_code || 'N/A'}`);
        console.log(`   Status: ${pixel.status || 'N/A'}`);
      });
    } else {
      console.log('\n⚠️  Pixelが見つかりませんでした');
    }
  } catch (error: any) {
    console.log('❌ エラー発生\n');
    if (error.response) {
      console.log('ステータスコード:', error.response.status);
      console.log('レスポンスデータ:');
      console.log(JSON.stringify(error.response.data, null, 2));
    } else {
      console.log('エラーメッセージ:', error.message);
    }
  }

  await prisma.$disconnect();
}

checkPixel().catch(console.error);
