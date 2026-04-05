/**
 * Smart+広告の過去データ取得テスト
 */
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();
const TIKTOK_API_BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';
const accessToken = process.env.TIKTOK_ACCESS_TOKEN!;

async function main() {
  try {
    // AI_1のAdvertiser ID
    const advertiserId = '7468288053866561553';

    console.log('Testing Smart+ Historical Report API...');
    console.log('Advertiser ID:', advertiserId);

    // 2026年1月のデータを取得（Smart+専用API）
    console.log('\n--- 2026年1月16日〜18日のデータ取得 ---');
    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/material_report/overview/`, {
      headers: { 'Access-Token': accessToken },
      params: {
        advertiser_id: advertiserId,
        dimensions: JSON.stringify(['smart_plus_ad_id', 'main_material_id']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
        start_date: '2026-01-16',
        end_date: '2026-01-18',
        page: 1,
        page_size: 100,
      },
    });

    console.log('\nAPI Response:');
    console.log('Code:', response.data.code);
    console.log('Message:', response.data.message);
    console.log('Total:', response.data.data?.page_info?.total_number || 0);

    if (response.data.data?.list?.length > 0) {
      console.log('\nデータあり:');
      let totalSpend = 0;
      const adSpends = new Map<string, number>();

      for (const item of response.data.data.list.slice(0, 20)) {
        const smartPlusAdId = item.dimensions?.smart_plus_ad_id;
        const spend = parseFloat(item.metrics?.spend || '0');
        totalSpend += spend;

        // smart_plus_ad_id別に集計
        adSpends.set(smartPlusAdId, (adSpends.get(smartPlusAdId) || 0) + spend);

        if (spend > 0) {
          console.log(`  ID: ${smartPlusAdId}, spend: ¥${spend.toFixed(0)}`);
        }
      }

      console.log(`\n合計spend: ¥${totalSpend.toFixed(0)}`);
      console.log(`ユニーク広告数: ${adSpends.size}`);
    } else {
      console.log('\nデータなし');
      console.log('Full response:', JSON.stringify(response.data, null, 2));
    }

    // 2025年11月のデータも確認（メトリクスがある期間）
    console.log('\n\n--- 2025年11月3日〜5日のデータ取得（比較用）---');
    const response2 = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/material_report/overview/`, {
      headers: { 'Access-Token': accessToken },
      params: {
        advertiser_id: advertiserId,
        dimensions: JSON.stringify(['smart_plus_ad_id', 'main_material_id']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
        start_date: '2025-11-03',
        end_date: '2025-11-05',
        page: 1,
        page_size: 100,
      },
    });

    console.log('\nAPI Response:');
    console.log('Code:', response2.data.code);
    console.log('Message:', response2.data.message);
    console.log('Total:', response2.data.data?.page_info?.total_number || 0);

    if (response2.data.data?.list?.length > 0) {
      console.log('\nデータあり:');
      let totalSpend = 0;
      for (const item of response2.data.data.list.slice(0, 10)) {
        const smartPlusAdId = item.dimensions?.smart_plus_ad_id;
        const spend = parseFloat(item.metrics?.spend || '0');
        totalSpend += spend;
        if (spend > 0) {
          console.log(`  ID: ${smartPlusAdId}, spend: ¥${spend.toFixed(0)}`);
        }
      }
      console.log(`\n合計spend: ¥${totalSpend.toFixed(0)}`);
    }

  } catch (error: any) {
    console.error('Error:', error.response?.data || error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
