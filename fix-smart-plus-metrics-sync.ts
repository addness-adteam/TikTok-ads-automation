import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api';
const ADVERTISER_ID = '7247073333517238273';

async function main() {
  console.log('='.repeat(80));
  console.log('Smart+ 広告メトリクスの手動同期');
  console.log('='.repeat(80));

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: ADVERTISER_ID }
  });

  if (!token) {
    console.log('Token not found');
    return;
  }

  // 問題の広告のsmart_plus_ad_id
  const targetSmartPlusAdId = '1849941219656738';

  // 問題の広告をDBから取得
  const targetAd = await prisma.ad.findUnique({
    where: { tiktokId: targetSmartPlusAdId }
  });

  if (!targetAd) {
    console.log('対象広告がDBに見つかりません。先に広告同期を実行してください。');
    return;
  }

  console.log(`対象広告: ${targetAd.name} (DB ID: ${targetAd.id})`);

  // 過去7日間のメトリクスを取得
  const today = new Date();
  const startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const endDate = new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`\n[Step 1] Smart+ material_report APIからメトリクスを取得 (${startDate} ~ ${endDate})...`);

  try {
    // Smart+ material_report APIでは日別の取得ができない
    // 期間全体の集計のみ取得可能
    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/material_report/overview/`, {
      headers: {
        'Access-Token': token.accessToken,
        'Content-Type': 'application/json',
      },
      params: {
        advertiser_id: ADVERTISER_ID,
        dimensions: JSON.stringify(['smart_plus_ad_id', 'main_material_id']),
        metrics: JSON.stringify([
          'impressions',
          'clicks',
          'spend',
          'ctr',
          'cpc',
          'cpm',
          'conversion',
          'cost_per_conversion',
          'video_watched_2s',
          'video_watched_6s',
        ]),
        start_date: startDate,
        end_date: endDate,
        filtering: JSON.stringify({
          smart_plus_ad_ids: [targetSmartPlusAdId],
        }),
        page_size: 100,
      },
    });

    console.log(`Response code: ${response.data.code}`);
    console.log(`Message: ${response.data.message}`);

    if (response.data.code === 0 && response.data.data?.list) {
      const metricsData = response.data.data.list;
      console.log(`取得したメトリクス件数: ${metricsData.length}`);

      // smart_plus_ad_id ごとにクリエイティブのメトリクスを集計
      const adMetrics = {
        impressions: 0,
        clicks: 0,
        spend: 0,
        conversions: 0,
        videoWatched2s: 0,
        videoWatched6s: 0,
      };

      for (const record of metricsData) {
        const metrics = record.metrics || {};
        adMetrics.impressions += parseInt(metrics.impressions || '0', 10);
        adMetrics.clicks += parseInt(metrics.clicks || '0', 10);
        adMetrics.spend += parseFloat(metrics.spend || '0');
        adMetrics.conversions += parseInt(metrics.conversion || '0', 10);
        adMetrics.videoWatched2s += parseInt(metrics.video_watched_2s || '0', 10);
        adMetrics.videoWatched6s += parseInt(metrics.video_watched_6s || '0', 10);
      }

      console.log(`\n集計結果 (${startDate}～${endDate}):`);
      console.log(`  spend=${adMetrics.spend}円, imp=${adMetrics.impressions}, clicks=${adMetrics.clicks}, cv=${adMetrics.conversions}`);

      // Smart+ メトリクスは期間全体の合算値として保存（昨日の日付で）
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      console.log(`\n[Step 2] メトリクスをDBに保存 (日付: ${yesterday.toISOString().split('T')[0]})...`);

      // 既存メトリクスを削除
      await prisma.metric.deleteMany({
        where: {
          entityType: 'AD',
          adId: targetAd.id,
          statDate: yesterday,
        },
      });

      // 新規メトリクスを作成
      await prisma.metric.create({
        data: {
          entityType: 'AD',
          adId: targetAd.id,
          statDate: yesterday,
          impressions: adMetrics.impressions,
          clicks: adMetrics.clicks,
          spend: adMetrics.spend,
          conversions: adMetrics.conversions,
          ctr: 0,
          cpc: 0,
          cpm: 0,
          cpa: 0,
          videoViews: 0,
          videoWatched2s: adMetrics.videoWatched2s,
          videoWatched6s: adMetrics.videoWatched6s,
        },
      });

      console.log(`\n合計支出: ${adMetrics.spend}円`);
    } else {
      console.log('メトリクスが取得できませんでした');
      console.log('レスポンス:', JSON.stringify(response.data, null, 2));
    }
  } catch (error: any) {
    console.error('API Error:', error.response?.data || error.message);
  }

  // 結果を確認
  console.log('\n[Step 3] 保存されたメトリクスを確認...');
  const savedMetrics = await prisma.metric.findMany({
    where: { adId: targetAd.id },
    orderBy: { statDate: 'desc' },
  });

  console.log(`保存されたメトリクス件数: ${savedMetrics.length}`);
  let totalSpend = 0;
  for (const m of savedMetrics) {
    console.log(`  ${m.statDate.toISOString().split('T')[0]}: spend=${m.spend}円`);
    totalSpend += m.spend;
  }
  console.log(`DB合計支出: ${totalSpend}円`);

  await prisma.$disconnect();
}

main().catch(console.error);
