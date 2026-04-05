import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testFixes() {
  const advertiserId = '7247073333517238273';

  // アクセストークンを取得
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId },
  });

  if (!token) {
    console.error('Access token not found');
    return;
  }

  console.log('=== テスト1: AdGroup取得（filtering パラメータの修正確認） ===\n');

  const adgroupId = '1847734887734369';

  try {
    const response = await axios.get('https://business-api.tiktok.com/open_api/v1.3/adgroup/get/', {
      headers: {
        'Access-Token': token.accessToken,
      },
      params: {
        advertiser_id: advertiserId,
        filtering: JSON.stringify({
          adgroup_ids: [adgroupId],
        }),
      },
    });

    const adgroup = response.data.data?.list?.[0];

    if (adgroup) {
      console.log('✅ AdGroup取得成功:');
      console.log(`  AdGroup ID: ${adgroup.adgroup_id}`);
      console.log(`  現在の予算: ${adgroup.budget}円`);
      console.log(`  予算モード: ${adgroup.budget_mode}`);
      console.log(`  ステータス: ${adgroup.operation_status}`);
      console.log('');
      console.log('📊 この値が最新のTikTok広告マネージャーの値と一致していることを確認してください。');
      console.log('');
    } else {
      console.log('❌ AdGroupが見つかりませんでした\n');
    }
  } catch (error) {
    console.error('❌ エラー:', error.response?.data || error.message);
  }

  console.log('=== 修正内容のまとめ ===\n');
  console.log('1. ✅ updateAd() - レスポンスコードチェックを追加');
  console.log('   - TikTok API が code !== 0 を返した場合はエラーをスロー');
  console.log('   - 広告停止が実際に成功したときのみ「成功」とログ出力');
  console.log('');
  console.log('2. ✅ updateAdGroup() - レスポンスコードチェックを追加');
  console.log('   - TikTok API が code !== 0 を返した場合はエラーをスロー');
  console.log('   - 予算更新が実際に成功したときのみ「成功」とログ出力');
  console.log('');
  console.log('3. ✅ updateAd() - adgroup_id フィールドを追加');
  console.log('   - TikTok API が要求する adgroup_id フィールドをリクエストボディに追加');
  console.log('   - 広告停止時の "Missing data for required field" エラーを修正');
  console.log('');
  console.log('4. ✅ getAdGroup() - filtering パラメータを JSON.stringify()');
  console.log('   - TikTok API が期待する形式で filtering パラメータを送信');
  console.log('   - 最新の予算データを正しく取得できるように修正');
  console.log('');
  console.log('=== 次のステップ ===\n');
  console.log('予算調整システムを再実行して、以下を確認してください:');
  console.log('1. 広告停止が実際に適用されるか（TikTok広告マネージャーで確認）');
  console.log('2. 予算増額が正しい値（現在の予算×1.3）で適用されるか');
  console.log('3. エラーが発生した場合、適切にログに記録されるか');
  console.log('');

  await prisma.$disconnect();
}

testFixes().catch(console.error);
