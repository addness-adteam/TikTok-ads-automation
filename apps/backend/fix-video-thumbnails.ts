import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function fixVideoThumbnails() {
  console.log('🔧 既存の動画Creativeにサムネイル画像IDを追加中...\n');

  const tiktokAdvertiserId = '7247073333517238273';
  const tiktokApiBaseUrl = 'https://business-api.tiktok.com/open_api';

  // アクセストークン取得
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: tiktokAdvertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found');
    await prisma.$disconnect();
    return;
  }

  // サムネイル画像IDがないVIDEO creativeを取得
  const videoCreatives = await prisma.creative.findMany({
    where: {
      type: 'VIDEO',
      tiktokImageId: null,
      tiktokVideoId: { not: null },
    },
  });

  console.log(`📊 処理対象: ${videoCreatives.length}件の動画Creative\n`);

  for (const creative of videoCreatives) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📹 Processing: ${creative.name}`);
    console.log(`   ID: ${creative.id}`);
    console.log(`   Video ID: ${creative.tiktokVideoId}`);

    try {
      // 1. 動画情報を取得してカバー画像URLを取得
      console.log(`\n📡 ステップ1: 動画情報を取得中...`);
      const videoInfoResponse = await axios.get(
        `${tiktokApiBaseUrl}/v1.3/file/video/ad/info/`,
        {
          params: {
            advertiser_id: tiktokAdvertiserId,
            video_ids: JSON.stringify([creative.tiktokVideoId]),
          },
          headers: {
            'Access-Token': token.accessToken,
          },
        },
      );

      const videoInfo = videoInfoResponse.data.data?.list?.[0];
      const videoCoverUrl = videoInfo?.video_cover_url;

      if (!videoCoverUrl) {
        console.log(`   ❌ 動画カバーURLが見つかりませんでした`);
        continue;
      }

      console.log(`   ✅ カバーURL取得成功: ${videoCoverUrl}`);

      // 2. カバー画像をTikTokにアップロード
      console.log(`\n📤 ステップ2: カバー画像をアップロード中...`);
      const imageUploadResponse = await axios.post(
        `${tiktokApiBaseUrl}/v1.3/file/image/ad/upload/`,
        {
          advertiser_id: tiktokAdvertiserId,
          image_url: videoCoverUrl,
          upload_type: 'UPLOAD_BY_URL',
        },
        {
          headers: {
            'Access-Token': token.accessToken,
            'Content-Type': 'application/json',
          },
        },
      );

      const imageId = imageUploadResponse.data.data?.image_id;

      if (!imageId) {
        console.log(`   ❌ 画像IDの取得に失敗しました`);
        console.log(`   レスポンス: ${JSON.stringify(imageUploadResponse.data)}`);
        continue;
      }

      console.log(`   ✅ サムネイル画像アップロード成功: ${imageId}`);

      // 3. DBを更新
      console.log(`\n💾 ステップ3: DBを更新中...`);
      await prisma.creative.update({
        where: { id: creative.id },
        data: { tiktokImageId: imageId },
      });

      console.log(`   ✅ DB更新成功！`);
      console.log(`\n🎉 ${creative.name} の処理が完了しました`);

    } catch (error: any) {
      console.log(`\n❌ エラー発生: ${creative.name}`);
      if (error.response?.data) {
        console.log(`   APIエラー: ${JSON.stringify(error.response.data)}`);
      } else {
        console.log(`   エラー: ${error.message}`);
      }
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`\n✅ 処理完了！合計 ${videoCreatives.length} 件を処理しました`);

  await prisma.$disconnect();
}

fixVideoThumbnails().catch(console.error);
