import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

// 全てのAdvertiser IDを取得
async function getAllAdvertiserIds() {
  const tokens = await prisma.oAuthToken.findMany({
    where: {
      expiresAt: { gt: new Date() }
    },
    select: { advertiserId: true, accessToken: true }
  });
  return tokens;
}

async function searchAdsInTikTokAPI(advertiserId: string, accessToken: string, searchTerm: string) {
  try {
    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/ad/get/`, {
      headers: {
        'Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      params: {
        advertiser_id: advertiserId,
        filtering: JSON.stringify({
          primary_status: 'STATUS_ENABLE'
        }),
        page_size: 1000,
      },
    });

    if (response.data.code === 0 && response.data.data?.list) {
      const matchingAds = response.data.data.list.filter((ad: any) =>
        ad.ad_name && (
          ad.ad_name.includes(searchTerm) ||
          ad.ad_name.includes('251128') ||
          ad.ad_name.includes('高橋海斗') ||
          ad.ad_name.includes('CR00586')
        )
      );
      return matchingAds;
    }
    return [];
  } catch (error: any) {
    console.error(`Error searching ads for ${advertiserId}:`, error.message);
    return [];
  }
}

async function getAdReportFromAPI(advertiserId: string, accessToken: string, adId: string) {
  try {
    const startDate = '2025-11-25';
    const endDate = '2025-12-01';

    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/report/integrated/get/`, {
      headers: {
        'Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      params: {
        advertiser_id: advertiserId,
        data_level: 'AUCTION_AD',
        dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
        start_date: startDate,
        end_date: endDate,
        filtering: JSON.stringify({ ad_ids: [adId] }),
        page_size: 100,
      },
    });

    if (response.data.code === 0 && response.data.data?.list) {
      return response.data.data.list;
    }
    return [];
  } catch (error: any) {
    console.error(`Error getting report for ad ${adId}:`, error.message);
    return [];
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('TikTok APIから直接広告を検索');
  console.log('検索対象: 251128/高橋海斗/ピザ→問題ないです（リール投稿）/LP1-CR00586');
  console.log('='.repeat(80));

  const tokens = await getAllAdvertiserIds();
  console.log(`\n取得したOAuthToken数: ${tokens.length}`);

  for (const token of tokens) {
    console.log(`\n[Advertiser: ${token.advertiserId}] 検索中...`);

    const matchingAds = await searchAdsInTikTokAPI(token.advertiserId, token.accessToken, 'ピザ');

    if (matchingAds.length > 0) {
      console.log(`  見つかった広告: ${matchingAds.length} 件`);
      for (const ad of matchingAds) {
        console.log(`    - 広告ID: ${ad.ad_id}`);
        console.log(`      広告名: ${ad.ad_name}`);
        console.log(`      ステータス: ${ad.operation_status}`);
        console.log(`      広告グループID: ${ad.adgroup_id}`);
        console.log(`      キャンペーンID: ${ad.campaign_id}`);

        // DBに存在するか確認
        const dbAd = await prisma.ad.findUnique({
          where: { tiktokId: String(ad.ad_id) }
        });
        console.log(`      DB同期: ${dbAd ? '✓ 存在' : '✗ 未同期'}`);

        // メトリクスを取得
        if (ad.ad_name.includes('251128') || ad.ad_name.includes('CR00586') || ad.ad_name.includes('高橋海斗')) {
          console.log(`\n      [メトリクス詳細取得中...]`);
          const metrics = await getAdReportFromAPI(token.advertiserId, token.accessToken, ad.ad_id);

          if (metrics.length > 0) {
            let totalSpend = 0;
            for (const m of metrics) {
              const spend = parseFloat(m.metrics?.spend || '0');
              totalSpend += spend;
              console.log(`        日付: ${m.dimensions?.stat_time_day}, 支出: ${spend}円`);
            }
            console.log(`      API合計支出: ${totalSpend}円`);

            // DBメトリクスと比較
            if (dbAd) {
              const dbMetrics = await prisma.metric.findMany({
                where: {
                  adId: dbAd.id,
                  statDate: {
                    gte: new Date('2025-11-25'),
                    lte: new Date('2025-12-01')
                  }
                }
              });
              const dbTotalSpend = dbMetrics.reduce((sum, m) => sum + m.spend, 0);
              console.log(`      DB合計支出: ${dbTotalSpend}円`);
              console.log(`      差異: ${totalSpend - dbTotalSpend}円`);
            }
          } else {
            console.log(`      APIからメトリクスなし`);
          }
        }
      }
    }
  }

  // Smart+広告も確認
  console.log('\n\n='.repeat(40));
  console.log('Smart+広告の確認');
  console.log('='.repeat(40));

  for (const token of tokens) {
    try {
      const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/ad/get/`, {
        headers: {
          'Access-Token': token.accessToken,
          'Content-Type': 'application/json',
        },
        params: {
          advertiser_id: token.advertiserId,
          page_size: 1000,
        },
      });

      if (response.data.code === 0 && response.data.data?.list) {
        const smartPlusAds = response.data.data.list.filter((ad: any) =>
          ad.ad_name?.includes('ピザ') ||
          ad.ad_name?.includes('251128') ||
          ad.ad_name?.includes('高橋海斗') ||
          ad.ad_name?.includes('CR00586')
        );

        if (smartPlusAds.length > 0) {
          console.log(`\n[Advertiser: ${token.advertiserId}] Smart+広告:`);
          for (const ad of smartPlusAds) {
            console.log(`  - 広告名: ${ad.ad_name}`);
            console.log(`    Smart+ Ad ID: ${ad.smart_plus_ad_id}`);
          }
        }
      }
    } catch (error: any) {
      // Smart+ APIエラーは無視
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
