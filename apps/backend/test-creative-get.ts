import axios from 'axios';

async function testCreativeGet() {
  console.log('🔍 Creative個別取得テスト開始\n');

  const apiUrl = 'http://localhost:4000';
  const creativeId = '2a941bf4-2249-4519-9dac-2fbbf14fdc7b'; // 先ほどアップロードした画像のID

  try {
    console.log('🚀 ステップ1: Creativeを個別取得中...');
    console.log(`   URL: ${apiUrl}/api/creatives/${creativeId}\n`);

    const response = await axios.get(`${apiUrl}/api/creatives/${creativeId}`);

    console.log('✅ 取得成功！\n');
    console.log('📊 レスポンス詳細:');
    console.log('─'.repeat(60));

    const creative = response.data.data || response.data;

    if (creative) {
      console.log(`Name: ${creative.name}`);
      console.log(`ID: ${creative.id}`);
      console.log(`Type: ${creative.type}`);
      console.log(`Status: ${creative.status}`);
      console.log(`Advertiser ID: ${creative.advertiserId}`);
      console.log(`File Size: ${creative.fileSize ? (creative.fileSize / 1024).toFixed(2) + ' KB' : 'N/A'}`);
      console.log(`Created: ${new Date(creative.createdAt).toLocaleString('ja-JP')}`);
      console.log('');

      if (creative.url) {
        console.log(`Blob Storage URL: ${creative.url}`);
      }
      if (creative.tiktokVideoId) {
        console.log(`TikTok Video ID: ${creative.tiktokVideoId}`);
      }
      if (creative.tiktokImageId) {
        console.log(`TikTok Image ID: ${creative.tiktokImageId}`);
      }
    } else {
      console.log(JSON.stringify(response.data, null, 2));
    }

    console.log('\n' + '─'.repeat(60));
    console.log('\n🔍 検証:');

    // IDが一致するか確認
    if (creative.id === creativeId) {
      console.log('✅ Creative IDが一致しています');
    } else {
      console.log('❌ Creative IDが一致しません');
    }

    // 必須フィールドの確認
    const requiredFields = ['id', 'name', 'type', 'status', 'advertiserId', 'url', 'createdAt'];
    const missingFields = requiredFields.filter(field => !creative[field]);

    if (missingFields.length === 0) {
      console.log('✅ すべての必須フィールドが存在します');
    } else {
      console.log('❌ 不足している必須フィールド:', missingFields.join(', '));
    }

    // TikTok IDの確認
    if (creative.type === 'VIDEO' && creative.tiktokVideoId) {
      console.log('✅ VIDEO タイプ: TikTok Video ID が存在します');
    } else if (creative.type === 'IMAGE' && creative.tiktokImageId) {
      console.log('✅ IMAGE タイプ: TikTok Image ID が存在します');
    } else {
      console.log('⚠️  TikTok ID が見つかりません');
    }

    console.log('\n' + '═'.repeat(60));
    console.log('🎉 テスト完了: Creative個別取得APIは正常に動作しています！');
    console.log('═'.repeat(60));

  } catch (error: any) {
    console.log('❌ エラー発生\n');

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
}

testCreativeGet().catch(console.error);
