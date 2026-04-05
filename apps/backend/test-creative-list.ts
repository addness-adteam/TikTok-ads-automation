import axios from 'axios';

async function testCreativeList() {
  console.log('📋 Creative一覧取得テスト開始\n');

  const apiUrl = 'http://localhost:4000';

  try {
    console.log('🚀 ステップ1: Creative一覧を取得中...');
    console.log(`   URL: ${apiUrl}/api/creatives\n`);

    const response = await axios.get(`${apiUrl}/api/creatives`);

    console.log('✅ 取得成功！\n');
    console.log('📊 レスポンス詳細:');
    console.log('─'.repeat(60));

    const creatives = response.data.data || response.data;

    if (Array.isArray(creatives)) {
      console.log(`総件数: ${creatives.length}件\n`);

      // 最新5件を表示
      const recentCreatives = creatives.slice(0, 5);
      console.log('最新5件:');
      recentCreatives.forEach((creative, index) => {
        console.log(`\n${index + 1}. ${creative.name}`);
        console.log(`   ID: ${creative.id}`);
        console.log(`   Type: ${creative.type}`);
        console.log(`   Status: ${creative.status}`);
        console.log(`   Advertiser: ${creative.advertiser?.name || 'N/A'}`);
        console.log(`   Created: ${new Date(creative.createdAt).toLocaleString('ja-JP')}`);

        if (creative.tiktokVideoId) {
          console.log(`   TikTok Video ID: ${creative.tiktokVideoId}`);
        }
        if (creative.tiktokImageId) {
          console.log(`   TikTok Image ID: ${creative.tiktokImageId}`);
        }
      });
    } else {
      console.log(JSON.stringify(response.data, null, 2));
    }

    console.log('\n' + '─'.repeat(60));
    console.log('\n' + '═'.repeat(60));
    console.log('🎉 テスト完了: Creative一覧取得APIは正常に動作しています！');
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

testCreativeList().catch(console.error);
