/**
 * TikTok API レポートテスト
 */
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();
const TIKTOK_API_BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';
const accessToken = process.env.TIKTOK_ACCESS_TOKEN;

async function main() {
  try {
    // AI_1のAdvertiser IDを使用
    const advertiserId = '7468288053866561553';

    console.log('Testing TikTok Report API...');
    console.log('Advertiser ID:', advertiserId);

    // 2025年12月のレポートを取得（最近のデータを確認）
    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/report/integrated/get/`, {
      headers: { 'Access-Token': accessToken },
      params: {
        advertiser_id: advertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_AD',
        dimensions: JSON.stringify(['ad_id']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks']),
        start_date: '2025-12-01',
        end_date: '2025-12-31',
        page_size: 10,
      },
    });

    console.log('\nAPI Response:');
    console.log('Code:', response.data.code);
    console.log('Message:', response.data.message);
    console.log('Data list length:', response.data.data?.list?.length);

    if (response.data.data?.list?.length > 0) {
      console.log('\nFirst 3 items:');
      response.data.data.list.slice(0, 3).forEach((item: any, i: number) => {
        console.log(`\n[${i}]`, JSON.stringify(item, null, 2));
      });
    } else {
      console.log('\nNo data returned');
      console.log('Full response:', JSON.stringify(response.data, null, 2));
    }

  } catch (error: any) {
    console.error('API Error:', error.response?.data || error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
