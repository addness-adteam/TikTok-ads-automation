import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function getAdGroups() {
  console.log('🔍 既存のAdGroup一覧を取得\n');

  const tiktokAdvertiserId = '7247073333517238273';

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: tiktokAdvertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found');
    await prisma.$disconnect();
    return;
  }
  console.log('✅ アクセストークン取得成功\n');

  try {
    // AdGroup一覧を取得
    console.log('📡 TikTok APIからAdGroup一覧を取得中...\n');

    const response = await axios.get(
      'https://business-api.tiktok.com/open_api/v1.3/adgroup/get/',
      {
        params: {
          advertiser_id: tiktokAdvertiserId,
          page_size: 50,
        },
        headers: {
          'Access-Token': token.accessToken,
        },
      }
    );

    console.log('✅ AdGroup一覧取得成功\n');
    console.log('📊 レスポンス:');
    console.log('─'.repeat(80));
    console.log(JSON.stringify(response.data, null, 2));
    console.log('─'.repeat(80));
    console.log('');

    if (response.data.data?.list && response.data.data.list.length > 0) {
      console.log(`\n📋 AdGroup件数: ${response.data.data.list.length}件\n`);

      // LEAD_GENERATION キャンペーンのAdGroupを探す
      const leadGenAdGroups = response.data.data.list.filter((ag: any) => {
        // campaign_idからキャンペーン情報を確認する必要がありますが、
        // まずはすべてのAdGroupを表示
        return true;
      });

      leadGenAdGroups.forEach((ag: any, index: number) => {
        console.log(`${index + 1}. AdGroup ID: ${ag.adgroup_id}`);
        console.log(`   Name: ${ag.adgroup_name}`);
        console.log(`   Campaign ID: ${ag.campaign_id}`);
        console.log(`   Promotion Type: ${ag.promotion_type}`);
        console.log(`   Optimization Goal: ${ag.optimization_goal}`);
        console.log(`   Bid Type: ${ag.bid_type}`);
        console.log(`   Billing Event: ${ag.billing_event}`);
        console.log(`   Pixel ID: ${ag.pixel_id || 'なし'}`);
        console.log(`   Status: ${ag.operation_status}`);
        console.log('');
      });

      // LEAD_GENERATION AdGroupがあれば詳細を表示
      console.log('\n💡 次のステップ:');
      console.log('1. TikTok Ads Managerで手動でLEAD_GENERATIONのAdGroupを作成してください');
      console.log('2. 作成後、このスクリプトを再実行して設定を確認します');
    } else {
      console.log('⚠️  AdGroupが見つかりませんでした\n');
      console.log('💡 次のステップ:');
      console.log('1. TikTok Ads Managerにログイン');
      console.log('2. 手動でLEAD_GENERATIONキャンペーンとAdGroupを作成');
      console.log('3. 作成できた場合、このスクリプトを再実行して設定を確認');
      console.log('4. 作成できない場合、エラーメッセージを確認');
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

getAdGroups().catch(console.error);
