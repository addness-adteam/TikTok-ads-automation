/**
 * TikTok API 過去データ取得テスト
 * 特定の広告の初動期間（出稿日から3日間）のデータを取得
 */
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();
const TIKTOK_API_BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';
const accessToken = process.env.TIKTOK_ACCESS_TOKEN!;

// YYMMDD形式の文字列をYYYY-MM-DD形式に変換
function convertYYMMDDtoYYYYMMDD(yymmdd: string): string {
  const yy = yymmdd.substring(0, 2);
  const mm = yymmdd.substring(2, 4);
  const dd = yymmdd.substring(4, 6);
  return `20${yy}-${mm}-${dd}`;
}

// 日付を加算
function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

async function main() {
  try {
    // AI_1のAdvertiser ID
    const advertiserId = '7468288053866561553';

    // 2025年10月出稿の広告を1つ取得（LP名-CR番号パターン）
    const ad = await prisma.ad.findFirst({
      where: {
        name: {
          startsWith: '2510',
          contains: 'LP1-CR00',
        },
        adGroup: {
          campaign: {
            advertiser: {
              tiktokAdvertiserId: advertiserId,
            },
          },
        },
      },
      select: {
        tiktokId: true,
        name: true,
      },
    });

    if (!ad) {
      console.log('広告が見つかりません');
      return;
    }

    console.log('テスト広告:');
    console.log('  名前:', ad.name);
    console.log('  ID:', ad.tiktokId);

    // 広告名から出稿日を抽出
    const match = ad.name.match(/^(\d{6})\//);
    if (!match) {
      console.log('出稿日を抽出できません');
      return;
    }

    const launchDate = convertYYMMDDtoYYYYMMDD(match[1]);
    const endDate = addDays(launchDate, 2); // 出稿日を含む3日間

    console.log('  出稿日:', launchDate);
    console.log('  初動終了日:', endDate);

    // TikTok APIから広告費を取得
    console.log('\nAPI呼び出し中...');
    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/report/integrated/get/`, {
      headers: { 'Access-Token': accessToken },
      params: {
        advertiser_id: advertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_AD',
        dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversions']),
        start_date: launchDate,
        end_date: endDate,
        page_size: 100,
        filtering: JSON.stringify({
          ad_ids: [ad.tiktokId],
        }),
      },
    });

    console.log('\nAPI Response:');
    console.log('Code:', response.data.code);
    console.log('Message:', response.data.message);
    console.log('Total:', response.data.data?.page_info?.total_number || 0);

    if (response.data.data?.list?.length > 0) {
      console.log('\nデータ:');
      let totalSpend = 0;
      for (const item of response.data.data.list) {
        const date = item.dimensions?.stat_time_day;
        const spend = parseFloat(item.metrics?.spend || '0');
        const impressions = item.metrics?.impressions;
        const clicks = item.metrics?.clicks;
        totalSpend += spend;
        console.log(`  ${date}: spend=¥${spend.toFixed(0)}, imp=${impressions}, clicks=${clicks}`);
      }
      console.log(`\n  初動3日間合計: ¥${totalSpend.toFixed(0)}`);
    } else {
      console.log('\nデータなし');
      // フィルタリングなしで試す
      console.log('\nフィルタリングなしで再試行...');
      const response2 = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/report/integrated/get/`, {
        headers: { 'Access-Token': accessToken },
        params: {
          advertiser_id: advertiserId,
          report_type: 'BASIC',
          data_level: 'AUCTION_AD',
          dimensions: JSON.stringify(['ad_id']),
          metrics: JSON.stringify(['spend']),
          start_date: launchDate,
          end_date: endDate,
          page_size: 10,
        },
      });
      console.log('Total items:', response2.data.data?.page_info?.total_number || 0);
      if (response2.data.data?.list?.length > 0) {
        console.log('First few items:');
        response2.data.data.list.slice(0, 5).forEach((item: any) => {
          console.log(`  ID: ${item.dimensions?.ad_id}, spend: ${item.metrics?.spend}`);
        });
      }
    }
  } catch (error: any) {
    console.error('Error:', error.response?.data || error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
