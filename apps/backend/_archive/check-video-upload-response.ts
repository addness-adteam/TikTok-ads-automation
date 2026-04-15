import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import FormData from 'form-data';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function checkVideoUploadResponse() {
  console.log('🎬 動画アップロードレスポンスの全フィールドを確認中...\n');

  const tiktokAdvertiserId = '7247073333517238273';

  // アクセストークン取得
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: tiktokAdvertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found');
    await prisma.$disconnect();
    return;
  }

  // テスト用の小さい動画ファイルを読み込む（既存の動画を再アップロード）
  // 注: 実際のテストでは新しいファイルを用意してください
  const testVideoPath = path.join(__dirname, 'test-video.mp4');

  if (!fs.existsSync(testVideoPath)) {
    console.error('❌ テスト動画ファイルが見つかりません: test-video.mp4');
    console.log('💡 test-video.mp4 を apps/backend/ に配置してください');
    await prisma.$disconnect();
    return;
  }

  const videoBuffer = fs.readFileSync(testVideoPath);
  const md5Hash = crypto.createHash('md5').update(videoBuffer).digest('hex');
  const sanitizedFilename = `test_video_${Date.now()}.mp4`;

  console.log(`📤 動画をアップロード中...`);
  console.log(`   ファイル: ${testVideoPath}`);
  console.log(`   サイズ: ${videoBuffer.length} bytes`);
  console.log(`   MD5: ${md5Hash}\n`);

  try {
    const formData = new FormData();
    formData.append('advertiser_id', tiktokAdvertiserId);
    formData.append('upload_type', 'UPLOAD_BY_FILE');
    formData.append('video_signature', md5Hash);
    formData.append('video_file', videoBuffer, {
      filename: sanitizedFilename,
      contentType: 'video/mp4',
    });

    const response = await axios.post(
      'https://business-api.tiktok.com/open_api/v1.3/file/video/ad/upload/',
      formData,
      {
        headers: {
          'Access-Token': token.accessToken,
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      },
    );

    console.log('✅ 動画アップロード成功\n');
    console.log('📊 TikTok APIレスポンス（完全版）:');
    console.log('═'.repeat(80));
    console.log(JSON.stringify(response.data, null, 2));
    console.log('═'.repeat(80));

    // データ構造を詳しく解析
    if (response.data.data) {
      console.log('\n🔍 データ構造の詳細分析:\n');

      const data = Array.isArray(response.data.data)
        ? response.data.data[0]
        : response.data.data;

      if (data) {
        console.log('📋 全フィールド一覧:');
        Object.keys(data).forEach(key => {
          console.log(`   ${key}: ${JSON.stringify(data[key])}`);
        });

        console.log('\n💡 画像/サムネイル関連フィールド:');
        const imageRelatedKeys = Object.keys(data).filter(key =>
          key.toLowerCase().includes('image') ||
          key.toLowerCase().includes('cover') ||
          key.toLowerCase().includes('poster') ||
          key.toLowerCase().includes('thumbnail')
        );

        if (imageRelatedKeys.length > 0) {
          imageRelatedKeys.forEach(key => {
            console.log(`   ✅ ${key}: ${JSON.stringify(data[key])}`);
          });
        } else {
          console.log('   ❌ 画像/サムネイル関連のフィールドは見つかりませんでした');
        }

        console.log('\n🎯 重要な情報:');
        console.log(`   video_id: ${data.video_id || 'N/A'}`);
        console.log(`   width: ${data.width || 'N/A'}`);
        console.log(`   height: ${data.height || 'N/A'}`);
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

checkVideoUploadResponse().catch(console.error);
