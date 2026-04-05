import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

// 正しいエンドポイント: /v1.3/smart_plus/ad/get/
async function getSmartPlusAds(advertiserId: string, accessToken: string) {
  const baseUrl = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';

  let allAds: any[] = [];
  let currentPage = 1;
  const pageSize = 100;

  while (true) {
    try {
      console.log(`Fetching Smart+ ads page ${currentPage}...`);
      const response = await axios.get(`${baseUrl}/v1.3/smart_plus/ad/get/`, {
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        params: {
          advertiser_id: advertiserId,
          page: currentPage,
          page_size: pageSize,
        },
      });

      const data = response.data;
      console.log(`API Response code: ${data.code}, message: ${data.message}`);

      if (data.code !== 0) {
        console.error(`API Error for ${advertiserId}:`, data.message);
        break;
      }

      const ads = data.data?.list || [];
      allAds = allAds.concat(ads);

      const totalNumber = data.data?.page_info?.total_number || 0;
      const totalPage = Math.ceil(totalNumber / pageSize);
      console.log(`Page ${currentPage}/${totalPage}, got ${ads.length} ads, total so far: ${allAds.length}`);

      if (currentPage >= totalPage || ads.length === 0) {
        break;
      }
      currentPage++;
    } catch (error: any) {
      console.error(`Error fetching Smart+ ads:`, error.response?.data || error.message);
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

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Advertiser ID: ${token.advertiserId} (AI_1)`);
  console.log(`${'='.repeat(80)}`);

  // Smart+ 広告を取得
  const smartPlusAds = await getSmartPlusAds(token.advertiserId, token.accessToken);
  console.log(`\nTotal Smart+ ads retrieved: ${smartPlusAds.length}`);

  // インタビューを含む広告を探す
  const interviewAds = smartPlusAds.filter((ad: any) => {
    const name = ad.ad_name || '';
    return name.includes('インタビュー') || name.includes('CR00679') || name.includes('CR00680') || name.includes('251204');
  });

  console.log(`\n--- Ads containing インタビュー/CR00679/CR00680/251204 ---`);
  if (interviewAds.length > 0) {
    for (const ad of interviewAds) {
      console.log(`\n✅ Found: ${ad.ad_name}`);
      console.log(`   smart_plus_ad_id: ${ad.smart_plus_ad_id}`);
      console.log(`   status: ${ad.operation_status}`);
      console.log(`   adgroup_id: ${ad.adgroup_id}`);
      console.log(`   campaign_id: ${ad.campaign_id}`);
    }
  } else {
    console.log('❌ No matching ads found');
  }

  // 最近の広告（251204, 251203, 251202を含む）を探す
  const recentDatePatterns = ['251204', '251203', '251202', '251205'];
  const recentAds = smartPlusAds.filter((ad: any) => {
    const name = ad.ad_name || '';
    return recentDatePatterns.some(pattern => name.includes(pattern));
  });

  console.log(`\n--- Ads with recent dates (251202-251205) ---`);
  if (recentAds.length > 0) {
    for (const ad of recentAds) {
      console.log(`\n  ${ad.ad_name}`);
      console.log(`   smart_plus_ad_id: ${ad.smart_plus_ad_id}`);
    }
  } else {
    console.log('❌ No ads with recent dates found');
  }

  // 全広告名をソートして最新のものを表示
  console.log(`\n--- All Smart+ ad names (sorted) ---`);
  const sortedAds = [...smartPlusAds].sort((a, b) => {
    return (b.ad_name || '').localeCompare(a.ad_name || '');
  });

  // 251で始まる広告名を先に表示
  const ads251 = sortedAds.filter((ad: any) => (ad.ad_name || '').startsWith('251'));
  console.log(`\nAds starting with 251 (${ads251.length} total):`);
  ads251.slice(0, 50).forEach((ad: any) => {
    console.log(`  ${ad.ad_name} (id: ${ad.smart_plus_ad_id})`);
  });

  // TTで始まる広告名を表示
  const adsTT = sortedAds.filter((ad: any) => (ad.ad_name || '').startsWith('TT'));
  console.log(`\nAds starting with TT (${adsTT.length} total):`);
  adsTT.forEach((ad: any) => {
    console.log(`  ${ad.ad_name} (id: ${ad.smart_plus_ad_id})`);
  });

  // DBにある広告と比較
  console.log(`\n--- Comparison with DB ---`);
  const dbAds = await prisma.ad.findMany({
    where: {
      adGroup: {
        campaign: {
          advertiser: {
            tiktokAdvertiserId: '7468288053866561553'
          }
        }
      }
    },
    select: {
      tiktokId: true,
      name: true
    }
  });

  console.log(`DB ads count: ${dbAds.length}`);

  // APIにあるがDBにない広告
  const dbTiktokIds = new Set(dbAds.map(ad => ad.tiktokId));
  const notInDb = smartPlusAds.filter((ad: any) => !dbTiktokIds.has(String(ad.smart_plus_ad_id)));

  console.log(`\nSmart+ ads NOT in DB (${notInDb.length} total):`);
  notInDb.slice(0, 20).forEach((ad: any) => {
    console.log(`  ${ad.ad_name} (smart_plus_ad_id: ${ad.smart_plus_ad_id})`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
