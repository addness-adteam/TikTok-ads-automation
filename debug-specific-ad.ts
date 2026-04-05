import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api';

// 指定されたAdvertiser ID
const ADVERTISER_ID = '7247073333517238273';

async function main() {
  console.log('='.repeat(80));
  console.log('広告ID: 7247073333517238273 の詳細調査');
  console.log('問題の広告: 251128/高橋海斗/ピザ→問題ないです（リール投稿）/LP1-CR00586');
  console.log('='.repeat(80));

  // OAuthトークン取得
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: ADVERTISER_ID }
  });

  if (!token) {
    console.log('OAuthトークンが見つかりません');
    return;
  }

  const accessToken = token.accessToken;

  // 1. Smart+ ad/get APIから広告を取得
  console.log('\n[Step 1] Smart+ ad/get APIから広告を取得...');
  try {
    console.log(`Requesting: ${TIKTOK_API_BASE_URL}/v1.3/smart_plus/ad/get/`);
    console.log(`Advertiser ID: ${ADVERTISER_ID}`);

    // ページネーションで全件取得
    let page = 1;
    let allSmartPlusAds: any[] = [];
    let hasMore = true;

    while (hasMore) {
      const smartPlusResponse = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/ad/get/`, {
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        params: {
          advertiser_id: ADVERTISER_ID,
          page_size: 100,
          page: page,
        },
      });

      console.log(`Page ${page} Response code: ${smartPlusResponse.data.code}`);

      if (smartPlusResponse.data.code === 0 && smartPlusResponse.data.data?.list) {
        allSmartPlusAds = allSmartPlusAds.concat(smartPlusResponse.data.data.list);
        const pageInfo = smartPlusResponse.data.data.page_info;
        console.log(`Page ${page}: ${smartPlusResponse.data.data.list.length} ads (total so far: ${allSmartPlusAds.length})`);

        if (pageInfo && pageInfo.page * pageInfo.page_size < pageInfo.total_number) {
          page++;
        } else {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }

    console.log(`\nSmart+広告総数: ${allSmartPlusAds.length}`);

    if (allSmartPlusAds.length > 0) {
      const ads = allSmartPlusAds;

      // 問題の広告を探す
      for (const ad of ads) {
        if (ad.ad_name?.includes('251128') ||
            ad.ad_name?.includes('高橋海斗') ||
            ad.ad_name?.includes('ピザ') ||
            ad.ad_name?.includes('CR00586')) {
          console.log('\n  *** 問題の広告を発見 ***');
          console.log(`  広告名: ${ad.ad_name}`);
          console.log(`  smart_plus_ad_id: ${ad.smart_plus_ad_id}`);
          console.log(`  ad_id: ${ad.ad_id || 'なし'}`);
          console.log(`  operation_status: ${ad.operation_status}`);
          console.log(`  campaign_id: ${ad.campaign_id}`);
          console.log(`  adgroup_id: ${ad.adgroup_id}`);

          // DBに存在するか確認
          const dbAdBySmartPlusId = await prisma.ad.findUnique({
            where: { tiktokId: String(ad.smart_plus_ad_id) }
          });
          const dbAdByAdId = ad.ad_id ? await prisma.ad.findUnique({
            where: { tiktokId: String(ad.ad_id) }
          }) : null;

          console.log(`\n  DB確認:`);
          console.log(`    smart_plus_ad_id (${ad.smart_plus_ad_id}) で検索: ${dbAdBySmartPlusId ? '✓ 存在' : '✗ 未同期'}`);
          if (dbAdBySmartPlusId) {
            console.log(`      DB広告名: ${dbAdBySmartPlusId.name}`);
            console.log(`      DB ID: ${dbAdBySmartPlusId.id}`);
          }
          if (ad.ad_id) {
            console.log(`    ad_id (${ad.ad_id}) で検索: ${dbAdByAdId ? '✓ 存在' : '✗ 未同期'}`);
            if (dbAdByAdId) {
              console.log(`      DB広告名: ${dbAdByAdId.name}`);
            }
          }

          // メトリクスをAPIから取得
          console.log(`\n  [メトリクスをAPIから取得]`);
          const adIdToUse = ad.ad_id || ad.smart_plus_ad_id;

          const reportResponse = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/report/integrated/get/`, {
            headers: {
              'Access-Token': accessToken,
              'Content-Type': 'application/json',
            },
            params: {
              advertiser_id: ADVERTISER_ID,
              data_level: 'AUCTION_AD',
              dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
              metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
              start_date: '2025-11-25',
              end_date: '2025-12-01',
              filtering: JSON.stringify({ ad_ids: [adIdToUse] }),
              page_size: 100,
            },
          });

          console.log(`  API Response Code: ${reportResponse.data.code}`);
          if (reportResponse.data.code === 0 && reportResponse.data.data?.list?.length > 0) {
            let totalSpend = 0;
            for (const m of reportResponse.data.data.list) {
              const spend = parseFloat(m.metrics?.spend || '0');
              totalSpend += spend;
              console.log(`    日付: ${m.dimensions?.stat_time_day}, 支出: ${spend}円`);
            }
            console.log(`  API合計支出: ${totalSpend}円`);
          } else {
            console.log(`  メトリクスなし (ad_id: ${adIdToUse})`);

            // smart_plus_ad_idで再試行
            if (ad.smart_plus_ad_id !== adIdToUse) {
              console.log(`\n  smart_plus_ad_id (${ad.smart_plus_ad_id}) で再試行...`);
              const retryResponse = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/report/integrated/get/`, {
                headers: {
                  'Access-Token': accessToken,
                  'Content-Type': 'application/json',
                },
                params: {
                  advertiser_id: ADVERTISER_ID,
                  data_level: 'AUCTION_AD',
                  dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
                  metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
                  start_date: '2025-11-25',
                  end_date: '2025-12-01',
                  filtering: JSON.stringify({ ad_ids: [ad.smart_plus_ad_id] }),
                  page_size: 100,
                },
              });

              if (retryResponse.data.code === 0 && retryResponse.data.data?.list?.length > 0) {
                let totalSpend = 0;
                for (const m of retryResponse.data.data.list) {
                  const spend = parseFloat(m.metrics?.spend || '0');
                  totalSpend += spend;
                  console.log(`    日付: ${m.dimensions?.stat_time_day}, 支出: ${spend}円`);
                }
                console.log(`  API合計支出 (smart_plus_ad_id): ${totalSpend}円`);
              }
            }
          }

          // DBのメトリクスを確認
          if (dbAdBySmartPlusId) {
            const dbMetrics = await prisma.metric.findMany({
              where: {
                adId: dbAdBySmartPlusId.id,
                statDate: {
                  gte: new Date('2025-11-25'),
                  lte: new Date('2025-12-02')
                }
              },
              orderBy: { statDate: 'desc' }
            });
            console.log(`\n  DBメトリクス数: ${dbMetrics.length}`);
            let dbTotalSpend = 0;
            for (const m of dbMetrics) {
              dbTotalSpend += m.spend;
              console.log(`    日付: ${m.statDate.toISOString().split('T')[0]}, 支出: ${m.spend}円`);
            }
            console.log(`  DB合計支出: ${dbTotalSpend}円`);
          }
        }
      }
    }
  } catch (error: any) {
    console.error('Smart+ API Error:', error.response?.data || error.message);
  }

  // 2. 通常のad/get APIから広告を取得（全ページ）
  console.log('\n\n[Step 2] 通常のad/get APIから広告を取得（全ページ）...');
  try {
    let page = 1;
    let allAds: any[] = [];
    let hasMore = true;

    while (hasMore) {
      const adsResponse = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/ad/get/`, {
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        params: {
          advertiser_id: ADVERTISER_ID,
          page_size: 1000,
          page: page,
        },
      });

      if (adsResponse.data.code === 0 && adsResponse.data.data?.list) {
        const ads = adsResponse.data.data.list;
        allAds = allAds.concat(ads);
        console.log(`Page ${page}: ${ads.length} ads`);

        const pageInfo = adsResponse.data.data.page_info;
        if (pageInfo && pageInfo.page * pageInfo.page_size < pageInfo.total_number) {
          page++;
        } else {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }

    console.log(`\n通常広告総数: ${allAds.length}`);

    // 問題の広告を探す
    let foundTarget = false;
    for (const ad of allAds) {
      if (ad.ad_name?.includes('251128') ||
          ad.ad_name?.includes('高橋海斗') ||
          ad.ad_name?.includes('CR00586')) {
        foundTarget = true;
        console.log(`\n  *** 問題の広告候補 ***`);
        console.log(`  広告名: ${ad.ad_name}`);
        console.log(`  ad_id: ${ad.ad_id}`);
        console.log(`  operation_status: ${ad.operation_status}`);
        console.log(`  campaign_id: ${ad.campaign_id}`);
        console.log(`  adgroup_id: ${ad.adgroup_id}`);

        const dbAd = await prisma.ad.findUnique({
          where: { tiktokId: String(ad.ad_id) }
        });
        console.log(`  DB同期: ${dbAd ? `✓ 存在 (DB name: ${dbAd.name})` : '✗ 未同期'}`);

        // メトリクスを取得
        console.log(`\n  [APIからメトリクス取得]`);
        const reportResponse = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/report/integrated/get/`, {
          headers: {
            'Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
          params: {
            advertiser_id: ADVERTISER_ID,
            data_level: 'AUCTION_AD',
            dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
            metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
            start_date: '2025-11-25',
            end_date: '2025-12-01',
            filtering: JSON.stringify({ ad_ids: [ad.ad_id] }),
            page_size: 100,
          },
        });

        if (reportResponse.data.code === 0 && reportResponse.data.data?.list?.length > 0) {
          let totalSpend = 0;
          for (const m of reportResponse.data.data.list) {
            const spend = parseFloat(m.metrics?.spend || '0');
            totalSpend += spend;
            console.log(`    日付: ${m.dimensions?.stat_time_day}, 支出: ${spend}円`);
          }
          console.log(`  API合計支出: ${totalSpend}円`);
        } else {
          console.log(`  メトリクスなし`);
        }

        // DBメトリクス確認
        if (dbAd) {
          const dbMetrics = await prisma.metric.findMany({
            where: {
              adId: dbAd.id,
              statDate: {
                gte: new Date('2025-11-25'),
                lte: new Date('2025-12-02')
              }
            }
          });
          const dbTotalSpend = dbMetrics.reduce((sum, m) => sum + m.spend, 0);
          console.log(`  DBメトリクス数: ${dbMetrics.length}, DB合計支出: ${dbTotalSpend}円`);
        }
      }
    }

    if (!foundTarget) {
      console.log('\n  問題の広告名 (251128/高橋海斗/CR00586) が見つかりませんでした');
      console.log('  ピザを含む広告を表示:');
      for (const ad of allAds) {
        if (ad.ad_name?.includes('ピザ')) {
          console.log(`    - ${ad.ad_name} (ad_id: ${ad.ad_id})`);
        }
      }
    }
  } catch (error: any) {
    console.error('Ads API Error:', error.response?.data || error.message);
  }

  // 3. DB内の該当Advertiserの広告を確認
  console.log('\n\n[Step 3] DB内のAdvertiser 7247073333517238273 の広告を確認...');
  const advertiser = await prisma.advertiser.findFirst({
    where: { tiktokAdvertiserId: ADVERTISER_ID },
    include: {
      campaigns: {
        include: {
          adGroups: {
            include: {
              ads: true
            }
          }
        }
      }
    }
  });

  if (advertiser) {
    console.log(`Advertiser: ${advertiser.name}`);
    let totalAds = 0;
    for (const camp of advertiser.campaigns) {
      for (const ag of camp.adGroups) {
        totalAds += ag.ads.length;
        for (const ad of ag.ads) {
          if (ad.name.includes('251128') ||
              ad.name.includes('高橋海斗') ||
              ad.name.includes('ピザ') ||
              ad.name.includes('CR00586')) {
            console.log(`  Found in DB: ${ad.name}`);
            console.log(`    tiktokId: ${ad.tiktokId}`);
          }
        }
      }
    }
    console.log(`DB内の総広告数: ${totalAds}`);
  } else {
    console.log('Advertiserが見つかりません');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
