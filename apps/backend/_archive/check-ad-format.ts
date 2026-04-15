import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function checkAdFormat() {
  const advertiserId = '7247073333517238273';
  const adId = '1847937633023249';

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId },
  });

  if (!token) {
    console.error('Access token not found');
    return;
  }

  const response = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
    headers: {
      'Access-Token': token.accessToken,
    },
    params: {
      advertiser_id: advertiserId,
      filtering: JSON.stringify({
        ad_ids: [adId],
      }),
    },
  });

  const ad = response.data.data?.list?.[0];

  if (ad) {
    console.log('=== 広告データ（ad_format含む） ===\n');
    console.log('ad_format:', ad.ad_format);
    console.log('\n=== creatives配列 ===');
    console.log(JSON.stringify(ad.creatives, null, 2));
    console.log('\n=== 全広告データ ===');
    console.log(JSON.stringify(ad, null, 2));
  } else {
    console.log('広告が見つかりませんでした');
  }

  await prisma.$disconnect();
}

checkAdFormat().catch(console.error);
