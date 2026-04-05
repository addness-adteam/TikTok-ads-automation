import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

// TikTok API から Smart+ 広告を直接取得
async function getSmartPlusAds(advertiserId: string, accessToken: string) {
  const baseUrl = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';

  let allAds: any[] = [];
  let currentPage = 1;
  const pageSize = 100;

  while (true) {
    try {
      const response = await axios.get(`${baseUrl}/v1.3/smart_plus_ad/get/`, {
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
      if (data.code !== 0) {
        console.error(`API Error for ${advertiserId}:`, data.message);
        break;
      }

      const ads = data.data?.list || [];
      allAds = allAds.concat(ads);

      const totalPage = Math.ceil((data.data?.page_info?.total_number || 0) / pageSize);
      if (currentPage >= totalPage || ads.length === 0) {
        break;
      }
      currentPage++;
    } catch (error: any) {
      console.error(`Error fetching Smart+ ads:`, error.message);
      break;
    }
  }

  return allAds;
}

// 通常の広告APIからも取得
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
        console.error(`API Error for ${advertiserId}:`, data.message);
        break;
      }

      const ads = data.data?.list || [];
      allAds = allAds.concat(ads);

      const totalPage = Math.ceil((data.data?.page_info?.total_number || 0) / pageSize);
      if (currentPage >= totalPage || ads.length === 0) {
        break;
      }
      currentPage++;
    } catch (error: any) {
      console.error(`Error fetching regular ads:`, error.message);
      break;
    }
  }

  return allAds;
}

async function main() {
  // SNS_1とAI_1のトークンを取得
  const tokens = await prisma.oAuthToken.findMany({
    where: {
      advertiserId: {
        in: ['7247073333517238273', '7468288053866561553']
      }
    }
  });

  console.log('Found tokens:', tokens.length);

  for (const token of tokens) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Advertiser ID: ${token.advertiserId}`);
    console.log(`${'='.repeat(80)}`);

    // Smart+ 広告を取得
    console.log('\n--- Smart+ Ads (from smart_plus_ad/get API) ---');
    const smartPlusAds = await getSmartPlusAds(token.advertiserId, token.accessToken);
    console.log(`Total Smart+ ads: ${smartPlusAds.length}`);

    // CR00679, CR00680, 251204, 高橋海斗 を検索
    const targetAds = smartPlusAds.filter((ad: any) => {
      const name = ad.ad_name || '';
      return name.includes('CR00679') ||
             name.includes('CR00680') ||
             name.includes('251204') ||
             name.includes('高橋海斗') ||
             name.includes('インタビュー');
    });

    if (targetAds.length > 0) {
      console.log('\n✅ Found target ads in Smart+ API:');
      for (const ad of targetAds) {
        console.log(`  - ${ad.ad_name}`);
        console.log(`    smart_plus_ad_id: ${ad.smart_plus_ad_id}`);
        console.log(`    status: ${ad.operation_status}`);
        console.log(`    adgroup_id: ${ad.adgroup_id}`);
      }
    } else {
      console.log('\n❌ No target ads found in Smart+ API');
      // 全Smart+ 広告名を表示
      console.log('\nAll Smart+ ad names:');
      smartPlusAds.slice(0, 30).forEach((ad: any) => {
        console.log(`  - ${ad.ad_name} (id: ${ad.smart_plus_ad_id})`);
      });
      if (smartPlusAds.length > 30) {
        console.log(`  ... and ${smartPlusAds.length - 30} more`);
      }
    }

    // 通常の広告APIからも確認
    console.log('\n--- Regular Ads (from ad/get API) ---');
    const regularAds = await getRegularAds(token.advertiserId, token.accessToken);
    console.log(`Total regular ads: ${regularAds.length}`);

    // Smart+関連の広告を検索
    const smartPlusRelated = regularAds.filter((ad: any) => !!ad.smart_plus_ad_id);
    console.log(`Smart+ related ads in regular API: ${smartPlusRelated.length}`);

    // CR00679, CR00680, 251204, 高橋海斗 を検索
    const targetRegularAds = regularAds.filter((ad: any) => {
      const name = ad.ad_name || '';
      return name.includes('CR00679') ||
             name.includes('CR00680') ||
             name.includes('251204') ||
             name.includes('高橋海斗') ||
             name.includes('インタビュー');
    });

    if (targetRegularAds.length > 0) {
      console.log('\n✅ Found target ads in Regular API:');
      for (const ad of targetRegularAds) {
        console.log(`  - ${ad.ad_name}`);
        console.log(`    ad_id: ${ad.ad_id}`);
        console.log(`    smart_plus_ad_id: ${ad.smart_plus_ad_id || 'N/A'}`);
        console.log(`    status: ${ad.operation_status}`);
      }
    } else {
      console.log('\n❌ No target ads found in Regular API');
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
