import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

// SNS1アカウントのAdvertiser ID
const SNS1_ADVERTISER_IDS = [
  '7247073333517238273',
  '7444791931353481232',
  '7444792446862606337',
  '7465989206452469777',
  '7468288053866561553',
  '7474920444831875080',
  '7504155142942474248',
  '7523128243466551303',
  '7534602103289823240',
  '7543540100849156112',
  '7543540381615800337',
  '7543540647266074641',
  '7563999950398078983'
];

async function main() {
  console.log('='.repeat(80));
  console.log('問題の広告を調査: 251128/高橋海斗/ピザ→問題ないです（リール投稿）/LP1-CR00586');
  console.log('期待支出: 9112円, 実行ログ支出: 0円');
  console.log('='.repeat(80));

  // 1. DBから広告を検索 - 正確な広告名で
  console.log('\n[Step 1] DBから広告名で検索...');

  // 251128と高橋海斗の両方を含む広告
  const targetAd = await prisma.ad.findMany({
    where: {
      AND: [
        { name: { contains: '251128' } },
        { name: { contains: '高橋海斗' } }
      ]
    },
    include: {
      adGroup: {
        include: {
          campaign: {
            include: {
              advertiser: true
            }
          }
        }
      }
    }
  });

  console.log(`'251128' AND '高橋海斗' で検索: ${targetAd.length} 件`);

  let foundAd = null;
  for (const ad of targetAd) {
    console.log(`  - 広告名: ${ad.name}`);
    console.log(`    TikTok ID: ${ad.tiktokId}`);
    console.log(`    DB ID: ${ad.id}`);
    console.log(`    ステータス: ${ad.status}`);
    console.log(`    広告セットID: ${ad.adGroup?.tiktokId}`);
    console.log(`    キャンペーンID: ${ad.adGroup?.campaign?.tiktokId}`);
    console.log(`    Advertiser: ${ad.adGroup?.campaign?.advertiser?.name} (${ad.adGroup?.campaign?.advertiser?.tiktokId})`);
    console.log(`    bidType: ${ad.adGroup?.bidType}`);
    foundAd = ad;
  }

  // ピザと高橋海斗でも検索
  console.log('\n"ピザ" を含む広告を検索...');
  const pizzaAds = await prisma.ad.findMany({
    where: { name: { contains: 'ピザ' } },
    include: {
      adGroup: {
        include: {
          campaign: {
            include: {
              advertiser: true
            }
          }
        }
      }
    }
  });

  console.log(`'ピザ' で検索: ${pizzaAds.length} 件`);
  for (const ad of pizzaAds) {
    console.log(`  - 広告名: ${ad.name}`);
    console.log(`    TikTok ID: ${ad.tiktokId}`);
    console.log(`    DB ID: ${ad.id}`);
    if (ad.name.includes('251128') || ad.name.includes('高橋海斗')) {
      foundAd = ad;
    }
  }

  // リール投稿で検索
  console.log('\n"リール投稿" を含む広告を検索...');
  const reelAds = await prisma.ad.findMany({
    where: { name: { contains: 'リール投稿' } },
    include: {
      adGroup: {
        include: {
          campaign: {
            include: {
              advertiser: true
            }
          }
        }
      }
    }
  });

  console.log(`'リール投稿' で検索: ${reelAds.length} 件`);
  for (const ad of reelAds) {
    console.log(`  - 広告名: ${ad.name}`);
    console.log(`    TikTok ID: ${ad.tiktokId}`);
    if (ad.name.includes('251128') || ad.name.includes('高橋海斗')) {
      foundAd = ad;
    }
  }

  // DBの全広告数を確認
  const totalAds = await prisma.ad.count();
  console.log(`\nDB内の全広告数: ${totalAds} 件`);

  // SNS appealのAdvertiserに紐づく広告を確認
  console.log('\n[Step 1b] SNS advertisersの広告を確認...');
  const snsAdvertisers = await prisma.advertiser.findMany({
    where: {
      appeal: { name: { contains: 'SNS' } }
    },
    include: {
      appeal: true,
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

  for (const adv of snsAdvertisers) {
    let adCount = 0;
    for (const camp of adv.campaigns) {
      for (const ag of camp.adGroups) {
        adCount += ag.ads.length;
      }
    }
    console.log(`  ${adv.name} (${adv.tiktokId}): ${adv.campaigns.length} campaigns, ${adCount} ads`);

    // 251128や高橋海斗を含む広告を探す
    for (const camp of adv.campaigns) {
      for (const ag of camp.adGroups) {
        for (const ad of ag.ads) {
          if (ad.name.includes('251128') || ad.name.includes('高橋海斗') || ad.name.includes('ピザ')) {
            console.log(`    Found: ${ad.name}`);
            console.log(`      TikTok ID: ${ad.tiktokId}`);
            foundAd = ad;
          }
        }
      }
    }
  }

  if (!foundAd) {
    console.log('\n広告がDBに見つかりません。TikTok APIから直接検索します...');
  }

  // 2. 該当広告のメトリクスをDBから取得
  if (foundAd) {
    console.log('\n[Step 2] DBからメトリクスを取得...');

    // 過去7日間の範囲
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    const jstNow = new Date(now.getTime() + jstOffset);

    const endDate = new Date(jstNow);
    endDate.setUTCDate(endDate.getUTCDate() - 1);
    endDate.setUTCHours(23, 59, 59, 999);

    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 6);
    startDate.setUTCHours(0, 0, 0, 0);

    console.log(`検索期間: ${startDate.toISOString()} ~ ${endDate.toISOString()}`);

    const metrics = await prisma.metric.findMany({
      where: {
        adId: foundAd.id,
        statDate: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { statDate: 'desc' }
    });

    console.log(`\nメトリクス件数: ${metrics.length}`);
    let totalSpend = 0;
    for (const m of metrics) {
      console.log(`  日付: ${m.statDate.toISOString().split('T')[0]}, 支出: ${m.spend}円, imp: ${m.impressions}, clicks: ${m.clicks}`);
      totalSpend += m.spend;
    }
    console.log(`\n合計支出: ${totalSpend}円`);

    // 全期間のメトリクスも確認
    console.log('\n[Step 2b] 全期間のメトリクスを確認...');
    const allMetrics = await prisma.metric.findMany({
      where: { adId: foundAd.id },
      orderBy: { statDate: 'desc' }
    });

    console.log(`全メトリクス件数: ${allMetrics.length}`);
    for (const m of allMetrics) {
      console.log(`  日付: ${m.statDate.toISOString().split('T')[0]}, 支出: ${m.spend}円, imp: ${m.impressions}, clicks: ${m.clicks}`);
    }

    // 3. TikTok APIから直接メトリクスを取得
    console.log('\n[Step 3] TikTok APIから直接メトリクスを取得...');
    const advertiserId = foundAd.adGroup?.campaign?.advertiser?.tiktokId;

    if (advertiserId) {
      const today = new Date();
      const startDateStr = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const endDateStr = new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      console.log(`API検索期間: ${startDateStr} ~ ${endDateStr}`);

      try {
        const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/report/integrated/get/`, {
          headers: {
            'Access-Token': ACCESS_TOKEN,
            'Content-Type': 'application/json',
          },
          params: {
            advertiser_id: advertiserId,
            data_level: 'AUCTION_AD',
            dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
            metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion', 'cost_per_conversion']),
            start_date: startDateStr,
            end_date: endDateStr,
            filtering: JSON.stringify({ ad_ids: [foundAd.tiktokId] }),
            page_size: 100,
          },
        });

        console.log('\nAPI Response Code:', response.data.code);
        console.log('API Message:', response.data.message);

        if (response.data.code === 0 && response.data.data?.list) {
          console.log(`\nAPI結果: ${response.data.data.list.length} 件`);
          let apiTotalSpend = 0;
          for (const item of response.data.data.list) {
            const spend = parseFloat(item.metrics?.spend || '0');
            apiTotalSpend += spend;
            console.log(`  日付: ${item.dimensions?.stat_time_day}, 支出: ${spend}円, imp: ${item.metrics?.impressions}, clicks: ${item.metrics?.clicks}`);
          }
          console.log(`\nAPI合計支出: ${apiTotalSpend}円`);
        } else {
          console.log('APIデータなし');
        }
      } catch (error: any) {
        console.error('API Error:', error.response?.data || error.message);
      }
    }
  }

  // 4. SNS1アカウント全体の広告数を確認
  console.log('\n[Step 4] SNS appealの広告を確認...');
  const snsAdvertisers2 = await prisma.advertiser.findMany({
    where: {
      appeal: {
        name: { contains: 'SNS' }
      }
    },
    include: {
      appeal: true
    }
  });

  console.log(`SNS appealのAdvertiser: ${snsAdvertisers2.length} 件`);
  for (const adv of snsAdvertisers2) {
    console.log(`  - ${adv.tiktokId}: ${adv.name} (${adv.appeal?.name})`);
  }

  // 5. 本日の予算最適化で処理された広告を確認するためエンティティ同期状況を確認
  console.log('\n[Step 5] 最近同期された広告を確認...');
  const recentAds = await prisma.ad.findMany({
    where: {
      updatedAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
      }
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    include: {
      adGroup: {
        include: {
          campaign: {
            include: {
              advertiser: true
            }
          }
        }
      }
    }
  });

  console.log(`過去24時間に更新された広告: ${recentAds.length} 件`);
  for (const ad of recentAds.slice(0, 10)) {
    console.log(`  - ${ad.name}`);
    console.log(`    更新日時: ${ad.updatedAt.toISOString()}`);
    console.log(`    Advertiser: ${ad.adGroup?.campaign?.advertiser?.tiktokId}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
