import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function getJapanLocationId() {
  console.log('🗾 日本のLocation IDを取得中...\n');

  const tiktokAdvertiserId = '7247073333517238273';
  const apiBaseUrl = 'https://business-api.tiktok.com/open_api';

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

  try {
    // TikTok APIから地域情報を取得
    console.log('📡 TikTok APIから地域情報を取得中...\n');

    const response = await axios.get(
      `${apiBaseUrl}/v1.3/tool/region/`,
      {
        params: {
          advertiser_id: tiktokAdvertiserId,
          placements: JSON.stringify(['PLACEMENT_TIKTOK']),
          objective_type: 'LEAD_GENERATION',
          promotion_target_type: 'EXTERNAL_WEBSITE',
        },
        headers: {
          'Access-Token': token.accessToken,
        },
      }
    );

    console.log('✅ 地域情報取得成功\n');
    console.log('📊 レスポンス:');
    console.log('─'.repeat(80));
    console.log(JSON.stringify(response.data, null, 2));
    console.log('─'.repeat(80));

    // 日本を探す
    if (response.data.data?.list) {
      const regions = response.data.data.list;

      // 日本を探す（名前で検索）
      const japan = regions.find((r: any) =>
        r.name === 'Japan' ||
        r.name === '日本' ||
        r.name_en === 'Japan'
      );

      if (japan) {
        console.log('\n🎌 日本が見つかりました！');
        console.log('─'.repeat(80));
        console.log(`Location ID: ${japan.location_id}`);
        console.log(`Name: ${japan.name}`);
        console.log(`Name (EN): ${japan.name_en || 'N/A'}`);
        console.log(`Type: ${japan.type || 'N/A'}`);
        console.log('─'.repeat(80));
      } else {
        console.log('\n⚠️ 日本が見つかりませんでした。全ての地域を表示します：\n');
        regions.forEach((region: any) => {
          console.log(`ID: ${region.location_id} - Name: ${region.name} (${region.name_en || 'N/A'})`);
        });
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

getJapanLocationId().catch(console.error);
