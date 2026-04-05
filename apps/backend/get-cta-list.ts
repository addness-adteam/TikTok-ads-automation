import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function getCtaList() {
  console.log('📋 TikTok Call-to-Action リストを取得中...\n');

  const advertiserId = '7247073333517238273';

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId },
  });

  if (!token) {
    console.error('❌ Access token not found');
    await prisma.$disconnect();
    return;
  }

  try {
    // TikTok APIでCTAリストを取得
    const response = await axios.get(
      'https://business-api.tiktok.com/open_api/v1.3/tool/call_to_action/',
      {
        params: {
          advertiser_id: advertiserId,
        },
        headers: {
          'Access-Token': token.accessToken,
        },
      }
    );

    console.log('✅ CTAリスト取得成功\n');
    console.log('📊 利用可能なCall-to-Actions:');
    console.log('─'.repeat(80));

    if (response.data.data?.list) {
      const ctaList = response.data.data.list;
      console.log(`\n合計: ${ctaList.length}個のCTA\n`);

      ctaList.forEach((cta: any) => {
        console.log(`ID: ${cta.call_to_action_id}`);
        console.log(`   Name: ${cta.call_to_action_name}`);
        console.log(`   Display: ${cta.display_name || 'N/A'}`);
        console.log('');
      });

      // LEARN_MOREを探す
      const learnMore = ctaList.find((cta: any) =>
        cta.call_to_action_name === 'LEARN_MORE' ||
        cta.display_name?.includes('Learn More') ||
        cta.display_name?.includes('詳細')
      );

      if (learnMore) {
        console.log('🎯 "LEARN_MORE" CTA found:');
        console.log(`   ID: ${learnMore.call_to_action_id}`);
        console.log(`   Name: ${learnMore.call_to_action_name}`);
        console.log(`   Display: ${learnMore.display_name}`);
      }
    } else {
      console.log('レスポンス形式:');
      console.log(JSON.stringify(response.data, null, 2));
    }
    console.log('─'.repeat(80));

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

getCtaList().catch(console.error);
