import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function main() {
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: '7468288053866561553' }
  });

  if (!token) {
    console.error('Token not found');
    return;
  }

  const baseUrl = 'https://business-api.tiktok.com/open_api';

  // CR00679/CR00680のad_idでAPIを叩いて、smart_plus_ad_idが返るか確認
  console.log('=== 現在のad/get APIレスポンス確認 ===\n');

  // 元のad_id（修正前にDBに保存されていたID）
  const originalAdIds = ['1850472050889730', '1850472050886754'];

  const response = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
    headers: { 'Access-Token': token.accessToken },
    params: {
      advertiser_id: token.advertiserId,
      filtering: JSON.stringify({
        ad_ids: originalAdIds
      })
    }
  });

  const ads = response.data.data?.list || [];

  console.log(`Found ${ads.length} ads\n`);

  ads.forEach((ad: any) => {
    console.log(`ad_id: ${ad.ad_id}`);
    console.log(`smart_plus_ad_id: ${ad.smart_plus_ad_id}`);
    console.log(`ad_name: ${ad.ad_name}`);
    console.log(`typeof smart_plus_ad_id: ${typeof ad.smart_plus_ad_id}`);
    console.log(`!!smart_plus_ad_id: ${!!ad.smart_plus_ad_id}`);
    console.log('');
  });

  // 12/3に同期された広告も確認
  console.log('=== 12/3に同期された広告（クリエイティブ名で保存されているもの） ===\n');

  const dec3Ads = await prisma.ad.findMany({
    where: {
      name: { endsWith: '.mp4' },
      adGroup: {
        campaign: {
          advertiser: { tiktokAdvertiserId: '7468288053866561553' }
        }
      }
    },
    take: 5,
    select: { tiktokId: true, name: true, createdAt: true }
  });

  for (const ad of dec3Ads) {
    console.log(`DB tiktokId: ${ad.tiktokId}`);
    console.log(`DB name: ${ad.name}`);

    // APIで確認
    const apiResponse = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
      headers: { 'Access-Token': token.accessToken },
      params: {
        advertiser_id: token.advertiserId,
        filtering: JSON.stringify({ ad_ids: [ad.tiktokId] })
      }
    });

    const apiAd = apiResponse.data.data?.list?.[0];
    if (apiAd) {
      console.log(`API ad_id: ${apiAd.ad_id}`);
      console.log(`API smart_plus_ad_id: ${apiAd.smart_plus_ad_id || 'NULL'}`);
    } else {
      console.log(`API: Not found (might be smart_plus_ad_id)`);
    }
    console.log('');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
