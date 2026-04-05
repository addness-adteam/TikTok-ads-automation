import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function checkIdentities() {
  console.log('🔍 利用可能なIdentity一覧を取得\n');

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
  console.log('✅ アクセストークン取得成功\n');

  // TikTok APIからIdentity一覧を取得
  console.log('📡 TikTok APIからIdentity一覧を取得中...\n');
  try {
    const response = await axios.get(
      'https://business-api.tiktok.com/open_api/v1.3/identity/get/',
      {
        params: {
          advertiser_id: tiktokAdvertiserId,
        },
        headers: {
          'Access-Token': token.accessToken,
        },
      }
    );

    console.log('✅ Identity取得成功\n');
    console.log('📊 レスポンス:');
    console.log('─'.repeat(80));
    console.log(JSON.stringify(response.data, null, 2));
    console.log('─'.repeat(80));
    console.log('');

    if (response.data.data?.identities) {
      console.log('\n📋 利用可能なIdentity:');
      response.data.data.identities.forEach((identity: any, index: number) => {
        console.log(`\n${index + 1}. ${identity.display_name || identity.identity_id}`);
        console.log(`   Identity ID: ${identity.identity_id}`);
        console.log(`   Identity Type: ${identity.identity_type}`);
        console.log(`   Status: ${identity.bind_status || 'N/A'}`);

        if (identity.identity_authorized_bc_id) {
          console.log(`   Authorized BC ID: ${identity.identity_authorized_bc_id}`);
        }
      });

      console.log('\n' + '='.repeat(80));
      console.log('💡 上記のIdentity IDのいずれかを使用してください');
      console.log('='.repeat(80));
    } else {
      console.log('\n⚠️  Identityが見つかりませんでした');
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

checkIdentities().catch(console.error);
