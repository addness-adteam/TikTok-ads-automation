/**
 * AI_4のメトリクスを手動同期する
 * 1. 通常広告レポート取得
 * 2. Smart+レポート取得
 * 3. DBに保存
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const ADV_ID = '7580666710525493255';
const TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const API = 'https://business-api.tiktok.com/open_api';

async function postJson(url: string, body: any) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Access-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.json() as Promise<any>;
}

async function getJson(url: string) {
  const resp = await fetch(url, { headers: { 'Access-Token': TOKEN } });
  return resp.json() as Promise<any>;
}

async function main() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const endDate = new Date(jst.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const startDate = new Date(jst.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`期間: ${startDate} 〜 ${endDate}`);

  // 1. 通常広告レポート（report_type: BASIC を含む）
  console.log('\n=== 通常広告レポート ===');
  const reportBody = {
    advertiser_id: ADV_ID,
    data_level: 'AUCTION_AD',
    report_type: 'BASIC',
    dimensions: JSON.stringify(['stat_time_day', 'ad_id']),
    metrics: JSON.stringify(['impressions', 'clicks', 'spend', 'ctr', 'cpc', 'cpm', 'conversions', 'cost_per_conversion', 'video_views', 'video_watched_2s', 'video_watched_6s']),
    start_date: startDate,
    end_date: endDate,
    page: 1,
    page_size: 1000,
  };
  // GETにパラメータ付きで
  const params = new URLSearchParams();
  params.set('advertiser_id', ADV_ID);
  params.set('data_level', 'AUCTION_AD');
  params.set('report_type', 'BASIC');
  params.set('dimensions', JSON.stringify(['stat_time_day', 'ad_id']));
  params.set('metrics', JSON.stringify(['impressions', 'clicks', 'spend', 'ctr', 'cpc', 'cpm', 'cost_per_conversion']));
  params.set('start_date', startDate);
  params.set('end_date', endDate);
  params.set('page', '1');
  params.set('page_size', '1000');

  const reportResp = await getJson(`${API}/v1.3/report/integrated/get/?${params.toString()}`);
  console.log(`code: ${reportResp.code}, message: ${reportResp.message}`);
  const reportList = reportResp.data?.list || [];
  console.log(`レコード数: ${reportList.length}`);

  if (reportList.length > 0) {
    console.log('サンプル:', JSON.stringify(reportList[0], null, 2));
  }

  // 2. Smart+レポート
  console.log('\n=== Smart+レポート ===');
  const spParams = new URLSearchParams();
  spParams.set('advertiser_id', ADV_ID);
  spParams.set('start_date', startDate);
  spParams.set('end_date', endDate);
  spParams.set('page', '1');
  spParams.set('page_size', '100');
  spParams.set('dimensions', JSON.stringify(['smart_plus_ad_id', 'main_material_id']));
  spParams.set('metrics', JSON.stringify(['spend', 'impressions', 'clicks', 'onsite_form', 'cpc', 'cpm', 'ctr']));

  const spResp = await getJson(`${API}/v1.3/smart_plus/material_report/overview/?${spParams.toString()}`);
  console.log(`code: ${spResp.code}, message: ${spResp.message}`);
  const spList = spResp.data?.list || [];
  console.log(`レコード数: ${spList.length}`);

  if (spList.length > 0) {
    console.log('サンプル:', JSON.stringify(spList[0], null, 2));
  }

  // 3. 取得したデータをDBに保存
  console.log('\n=== DB保存 ===');
  let savedCount = 0;
  let skippedCount = 0;

  // 通常広告メトリクス保存
  for (const record of reportList) {
    const rawDate = record.dimensions?.stat_time_day;
    const adId = record.dimensions?.ad_id;
    const m = record.metrics || {};
    if (!rawDate || !adId) continue;

    const ad = await prisma.ad.findUnique({ where: { tiktokId: String(adId) } });
    if (!ad) {
      console.log(`  SKIP: ad ${adId} not in DB`);
      skippedCount++;
      continue;
    }

    // "2026-03-14 00:00:00" → "2026-03-14"
    const dateStr = rawDate.split(' ')[0];
    const statDate = new Date(`${dateStr}T00:00:00+09:00`);

    // 重複チェック＆削除
    await prisma.metric.deleteMany({
      where: { adId: ad.id, entityType: 'AD', statDate },
    });

    await prisma.metric.create({
      data: {
        entityType: 'AD',
        adId: ad.id,
        statDate,
        impressions: parseInt(m.impressions || '0', 10),
        clicks: parseInt(m.clicks || '0', 10),
        spend: parseFloat(m.spend || '0'),
        conversions: parseInt(m.conversions || '0', 10),
        ctr: parseFloat(m.ctr || '0'),
        cpc: parseFloat(m.cpc || '0'),
        cpm: parseFloat(m.cpm || '0'),
        cpa: parseFloat(m.cost_per_conversion || '0'),
        videoViews: parseInt(m.video_views || '0', 10),
        videoWatched2s: parseInt(m.video_watched_2s || '0', 10),
        videoWatched6s: parseInt(m.video_watched_6s || '0', 10),
      },
    });
    savedCount++;
  }

  // Smart+メトリクス保存（smart_plus_ad_id別に集約）
  const spAgg = new Map<string, { spend: number; imp: number; clicks: number; cv: number }>();
  for (const record of spList) {
    const spAdId = record.dimensions?.smart_plus_ad_id;
    const m = record.metrics || {};
    if (!spAdId) continue;

    if (!spAgg.has(spAdId)) spAgg.set(spAdId, { spend: 0, imp: 0, clicks: 0, cv: 0 });
    const agg = spAgg.get(spAdId)!;
    agg.spend += parseFloat(m.spend || '0');
    agg.imp += parseInt(m.impressions || '0', 10);
    agg.clicks += parseInt(m.clicks || '0', 10);
    agg.cv += parseInt(m.onsite_form || '0', 10);
  }

  // 日別データが取れないので、期間合計を各日に均等配分する代わりに
  // 各日の通常レポートで取れた日付リストに基づいて按分する
  // シンプルに昨日分として保存
  const yesterdayDate = new Date(`${endDate}T00:00:00+09:00`);
  for (const [spAdId, agg] of spAgg) {
    const ad = await prisma.ad.findUnique({ where: { tiktokId: String(spAdId) } });
    if (!ad) {
      console.log(`  SKIP Smart+: ad ${spAdId} not in DB`);
      skippedCount++;
      continue;
    }

    console.log(`  Smart+ ${spAdId}: spend=¥${agg.spend}, imp=${agg.imp}, cv=${agg.cv}`);

    // 期間全体の合計として保存（startDate〜endDateの中間日に保存）
    // 既存のSmart+メトリクスを削除して、期間全体分を保存
    await prisma.metric.deleteMany({
      where: {
        adId: ad.id,
        entityType: 'AD',
        statDate: { gte: new Date(`${startDate}T00:00:00+09:00`), lte: new Date(`${endDate}T23:59:59+09:00`) },
      },
    });

    // 日数で割って日別にする
    const days = 7;
    const dailySpend = agg.spend / days;
    const dailyImp = Math.round(agg.imp / days);
    const dailyClicks = Math.round(agg.clicks / days);

    for (let i = 0; i < days; i++) {
      const d = new Date(new Date(`${startDate}T00:00:00+09:00`).getTime() + i * 24 * 60 * 60 * 1000);
      await prisma.metric.create({
        data: {
          entityType: 'AD',
          adId: ad.id,
          statDate: d,
          impressions: dailyImp,
          clicks: dailyClicks,
          spend: dailySpend,
          conversions: 0, // Smart+はCVをonsite_formで取るが日別に分割不可
          ctr: 0,
          cpc: 0,
          cpm: 0,
          cpa: 0,
          videoViews: 0,
          videoWatched2s: 0,
          videoWatched6s: 0,
        },
      });
    }
    savedCount++;
  }

  console.log(`保存: ${savedCount}件, スキップ: ${skippedCount}件`);

  // 4. 確認
  const adv = await prisma.advertiser.findFirst({ where: { tiktokAdvertiserId: ADV_ID } });
  const totalMetrics = await prisma.$queryRaw<any[]>`
    SELECT count(*) as cnt FROM metrics m
    JOIN ads a ON m."adId" = a.id
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    WHERE c."advertiserId" = ${adv!.id}
  `;
  console.log(`\nAI_4 メトリクス総数: ${totalMetrics[0].cnt}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
