/**
 * CR00268の詳細調査 - タイムゾーンとデータ保存を確認
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();
const TIKTOK_API_BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';
const ADVERTISER_ID = '7474920444831875080';

async function main() {
  console.log('=== CR00268 詳細調査 ===\n');

  // 1. DBのメトリクスをタイムスタンプ付きで確認
  const ad = await prisma.ad.findFirst({
    where: { name: { contains: 'CR00268' } },
  });

  if (!ad) {
    console.log('広告が見つかりません');
    return;
  }

  console.log('【DBのメトリクス詳細】');
  const metrics = await prisma.metric.findMany({
    where: { adId: ad.id, entityType: 'AD' },
    orderBy: { statDate: 'asc' },
  });

  for (const m of metrics) {
    console.log(`statDate: ${m.statDate.toISOString()}`);
    console.log(`  -> UTC: ${m.statDate.toUTCString()}`);
    console.log(`  -> JST文字列: ${m.statDate.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    console.log(`  spend: ¥${m.spend}, impressions: ${m.impressions}, clicks: ${m.clicks}`);
    console.log(`  createdAt: ${m.createdAt.toISOString()}`);
    console.log('');
  }

  // 2. TikTok APIから直接データを取得して比較
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
  if (!accessToken) {
    console.log('TIKTOK_ACCESS_TOKEN が設定されていません');
    return;
  }

  console.log('\n【TikTok API直接取得】');

  // Smart+ material_report APIからデータを取得
  try {
    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/material_report/overview/`, {
      headers: { 'Access-Token': accessToken },
      params: {
        advertiser_id: ADVERTISER_ID,
        dimensions: JSON.stringify(['smart_plus_ad_id', 'stat_time_day']),
        metrics: JSON.stringify(['impressions', 'clicks', 'spend']),
        start_date: '2026-01-13',
        end_date: '2026-01-15',
        page: 1,
        page_size: 100,
        // CR00268のsmart_plus_ad_idでフィルタ
        filtering: JSON.stringify({ smart_plus_ad_ids: ['1854157341275345'] }),
      },
    });

    console.log('API Response code:', response.data.code);
    console.log('API Response message:', response.data.message);

    const list = response.data.data?.list || [];
    console.log(`取得レコード数: ${list.length}`);

    let apiTotalSpend = 0;
    for (const record of list) {
      const adId = record.dimensions?.smart_plus_ad_id;
      const statDate = record.dimensions?.stat_time_day;
      const m = record.metrics || {};
      const spend = parseFloat(m.spend || '0');
      apiTotalSpend += spend;

      console.log(`\n日付: ${statDate}`);
      console.log(`  ad_id: ${adId}`);
      console.log(`  spend: ¥${spend}`);
      console.log(`  impressions: ${m.impressions}`);
      console.log(`  clicks: ${m.clicks}`);
    }

    console.log(`\nAPI合計spend: ¥${apiTotalSpend.toFixed(0)}`);

  } catch (error: any) {
    console.error('API Error:', error.response?.data || error.message);
  }

  // 3. 同じ広告IDの別エンティティタイプのメトリクスを確認
  console.log('\n【他のエンティティタイプのメトリクス】');
  const otherMetrics = await prisma.metric.findMany({
    where: {
      OR: [
        { campaignId: ad.adgroupId },
        { adgroupId: ad.adgroupId },
      ],
      statDate: {
        gte: new Date('2026-01-13'),
        lte: new Date('2026-01-15'),
      },
    },
    orderBy: [{ entityType: 'asc' }, { statDate: 'asc' }],
  });

  for (const m of otherMetrics) {
    console.log(`${m.entityType} | ${m.statDate.toISOString().split('T')[0]} | spend: ¥${m.spend}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
