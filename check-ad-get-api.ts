import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

// 通常のad/get APIから広告を取得
async function getRegularAds(advertiserId: string, accessToken: string) {
  const baseUrl = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';

  let allAds: any[] = [];
  let currentPage = 1;
  const pageSize = 100;

  while (true) {
    try {
      const response = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        params: {
          advertiser_id: advertiserId,
          page: currentPage,
          page_size: pageSize,
          filtering: JSON.stringify({
            primary_status: 'STATUS_ALL',
          }),
        },
      });

      const data = response.data;
      if (data.code !== 0) {
        console.error(`API Error:`, data.message);
        break;
      }

      const ads = data.data?.list || [];
      allAds = allAds.concat(ads);

      const totalNumber = data.data?.page_info?.total_number || 0;
      const totalPage = Math.ceil(totalNumber / pageSize);

      if (currentPage >= totalPage || ads.length === 0) {
        break;
      }
      currentPage++;
    } catch (error: any) {
      console.error(`Error:`, error.response?.data || error.message);
      break;
    }
  }

  return allAds;
}

async function main() {
  // AI_1のトークンを取得
  const token = await prisma.oAuthToken.findUnique({
    where: {
      advertiserId: '7468288053866561553'  // AI_1
    }
  });

  if (!token) {
    console.error('Token not found for AI_1');
    return;
  }

  console.log(`\nFetching ads from ad/get API for AI_1...`);

  const allAds = await getRegularAds(token.advertiserId, token.accessToken);
  console.log(`Total ads from ad/get: ${allAds.length}`);

  // Smart+ 関連の広告を探す
  const smartPlusAds = allAds.filter((ad: any) => !!ad.smart_plus_ad_id);
  console.log(`Smart+ related ads: ${smartPlusAds.length}`);

  // 該当のsmart_plus_ad_idを探す
  const targetIds = ['1850472306618481', '1850472803071026'];
  console.log(`\n--- Looking for target smart_plus_ad_ids: ${targetIds.join(', ')} ---`);

  const matchingAds = allAds.filter((ad: any) =>
    targetIds.includes(String(ad.smart_plus_ad_id)) ||
    targetIds.includes(String(ad.ad_id))
  );

  if (matchingAds.length > 0) {
    console.log(`\n✅ Found ${matchingAds.length} matching ads in ad/get API:`);
    for (const ad of matchingAds) {
      console.log(`\n  ad_id: ${ad.ad_id}`);
      console.log(`  smart_plus_ad_id: ${ad.smart_plus_ad_id || 'N/A'}`);
      console.log(`  ad_name: ${ad.ad_name}`);
      console.log(`  status: ${ad.operation_status}`);
      console.log(`  adgroup_id: ${ad.adgroup_id}`);
    }
  } else {
    console.log(`\n❌ Target ads NOT found in ad/get API`);

    // smart_plus_ad_idでソートして最新のものを表示
    const sortedSmartPlus = smartPlusAds.sort((a: any, b: any) => {
      return Number(b.smart_plus_ad_id || 0) - Number(a.smart_plus_ad_id || 0);
    });

    console.log(`\nMost recent Smart+ ads in ad/get API (by smart_plus_ad_id):`);
    sortedSmartPlus.slice(0, 10).forEach((ad: any) => {
      console.log(`  ad_id: ${ad.ad_id}, smart_plus_ad_id: ${ad.smart_plus_ad_id}, name: ${ad.ad_name}`);
    });
  }

  // TTインタビューを含む広告を探す
  console.log(`\n--- Looking for インタビュー in ad/get API ---`);
  const interviewAds = allAds.filter((ad: any) =>
    (ad.ad_name || '').includes('インタビュー') || (ad.ad_name || '').includes('TT')
  );

  if (interviewAds.length > 0) {
    console.log(`Found ${interviewAds.length} ads:`);
    interviewAds.forEach((ad: any) => {
      console.log(`  ad_id: ${ad.ad_id}`);
      console.log(`  smart_plus_ad_id: ${ad.smart_plus_ad_id || 'N/A'}`);
      console.log(`  ad_name: ${ad.ad_name}`);
      console.log('');
    });
  }

  // DBの状態を確認
  console.log(`\n--- Checking DB for these tiktokIds ---`);
  const dbAds = await prisma.ad.findMany({
    where: {
      tiktokId: {
        in: ['1850472306618481', '1850472803071026', '1850472050889730', '1850472050886754']
      }
    }
  });

  if (dbAds.length > 0) {
    console.log(`Found ${dbAds.length} ads in DB:`);
    dbAds.forEach(ad => {
      console.log(`  tiktokId: ${ad.tiktokId}, name: ${ad.name}`);
    });
  } else {
    console.log(`No matching ads found in DB`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
