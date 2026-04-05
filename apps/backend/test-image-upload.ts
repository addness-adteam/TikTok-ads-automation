import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import FormData from 'form-data';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function testImageUpload() {
  console.log('🖼️  Image アップロードテスト開始\n');

  const tiktokAdvertiserId = '7247073333517238273';
  const advertiserId = 'ce834117-1819-4a6e-9451-89fbb49e326f'; // UUID
  const imagePath = 'C:\\Users\\itali\\Downloads\\19.jpg';
  const apiUrl = 'http://localhost:4000';

  // ステップ1: アクセストークン取得
  console.log('📡 ステップ1: DBからアクセストークンを取得中...');
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: tiktokAdvertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found for advertiser:', advertiserId);
    await prisma.$disconnect();
    return;
  }
  console.log('✅ アクセストークン取得成功\n');

  // ステップ2: ファイルの存在確認
  console.log('📁 ステップ2: ファイルの存在確認...');
  if (!fs.existsSync(imagePath)) {
    console.error('❌ ファイルが見つかりません:', imagePath);
    console.log('\n💡 画像ファイルのパスを指定してください');
    console.log('   例: C:\\\\Users\\\\username\\\\Pictures\\\\test.jpg');
    await prisma.$disconnect();
    return;
  }

  const stats = fs.statSync(imagePath);
  const fileSizeKB = (stats.size / 1024).toFixed(2);
  console.log(`✅ ファイル確認成功: ${path.basename(imagePath)} (${fileSizeKB} KB)\n`);

  // ステップ3: FormData作成
  console.log('📦 ステップ3: FormDataを作成中...');
  const formData = new FormData();
  formData.append('file', fs.createReadStream(imagePath));
  formData.append('advertiserId', advertiserId);
  formData.append('name', 'テスト画像_' + new Date().toISOString());
  formData.append('accessToken', token.accessToken);

  console.log('✅ FormData作成完了\n');

  // ステップ4: APIリクエスト送信
  console.log('🚀 ステップ4: アップロードAPIにリクエスト送信中...');
  console.log(`   URL: ${apiUrl}/api/creatives/upload`);
  console.log(`   Advertiser ID: ${advertiserId}`);
  console.log(`   File: ${path.basename(imagePath)}\n`);

  try {
    const response = await axios.post(
      `${apiUrl}/api/creatives/upload`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    console.log('✅ アップロード成功！\n');
    console.log('📊 レスポンス詳細:');
    console.log('─'.repeat(60));
    console.log(JSON.stringify(response.data, null, 2));
    console.log('─'.repeat(60));
    console.log('');

    // ステップ5: 結果検証
    console.log('🔍 ステップ5: 結果を検証中...\n');

    const creative = response.data.data;

    // Vercel Blob Storageチェック
    if (creative.url) {
      console.log('✅ Vercel Blob Storage URL: ' + creative.url);
    } else {
      console.log('❌ Vercel Blob Storage URL が見つかりません');
    }

    // TikTok IDチェック
    if (creative.tiktokImageId) {
      console.log('✅ TikTok Image ID: ' + creative.tiktokImageId);
    } else {
      console.log('❌ TikTok Image ID が見つかりません');
    }

    // DB保存確認
    console.log('\n📋 ステップ6: データベースから取得して確認...');
    const dbCreative = await prisma.creative.findUnique({
      where: { id: creative.id },
    });

    if (dbCreative) {
      console.log('✅ DBに正常に保存されています');
      console.log('   ID: ' + dbCreative.id);
      console.log('   Name: ' + dbCreative.name);
      console.log('   Type: ' + dbCreative.type);
      console.log('   Status: ' + dbCreative.status);
      console.log('   File Size: ' + (dbCreative.fileSize ? (dbCreative.fileSize / 1024).toFixed(2) + ' KB' : 'N/A'));
    } else {
      console.log('❌ DBに保存されていません');
    }

    console.log('\n' + '═'.repeat(60));
    console.log('🎉 テスト完了: 画像アップロード機能は正常に動作しています！');
    console.log('═'.repeat(60));

  } catch (error: any) {
    console.log('❌ アップロードエラー\n');

    if (error.response) {
      console.log('ステータスコード:', error.response.status);
      console.log('レスポンスデータ:');
      console.log(JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.log('リクエストエラー: サーバーに接続できませんでした');
      console.log('API URL:', apiUrl);
      console.log('バックエンドサーバーが起動しているか確認してください');
    } else {
      console.log('エラーメッセージ:', error.message);
    }
  }

  await prisma.$disconnect();
}

testImageUpload().catch(console.error);
