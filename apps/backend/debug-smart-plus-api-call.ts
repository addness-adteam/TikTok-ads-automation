/**
 * Smart+ API呼び出しのデバッグスクリプト
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();
const ADVERTISER_ID = '7474920444831875080';
const TIKTOK_API_BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';

async function main() {
  const token = await prisma.oAuthToken.findFirst({
    where: { advertiserId: ADVERTISER_ID },
  });

  if (!token) {
    throw new Error('Token not found');
  }

  const accessToken = token.accessToken;
  const today = new Date().toISOString().split('T')[0];

  console.log('=== Smart+ API デバッグ ===');
  console.log(`日付: ${today}`);
  console.log(`広告主ID: ${ADVERTISER_ID}`);

  // 1. フィルタなしでSmart+メトリクスを取得
  console.log('\n--- 1. フィルタなしでメトリクス取得 ---');
  try {
    const params = {
      advertiser_id: ADVERTISER_ID,
      dimensions: JSON.stringify(['smart_plus_ad_id', 'main_material_id']),
      metrics: JSON.stringify(['impressions', 'clicks', 'spend', 'conversion']),
      start_date: today,
      end_date: today,
      page: 1,
      page_size: 100,
    };

    console.log('リクエストパラメータ:', JSON.stringify(params, null, 2));

    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/material_report/overview/`, {
      headers: { 'Access-Token': accessToken },
      params,
    });

    console.log('レスポンスcode:', response.data.code);
    console.log('レスポンスmessage:', response.data.message);
    console.log('データ件数:', response.data.data?.list?.length || 0);

    const list = response.data.data?.list || [];
    if (list.length > 0) {
      // smart_plus_ad_idごとに集計して表示
      const adMap = new Map<string, { spend: number; impressions: number }>();
      for (const item of list) {
        const adId = item.dimensions?.smart_plus_ad_id;
        if (adId) {
          const existing = adMap.get(adId) || { spend: 0, impressions: 0 };
          existing.spend += parseFloat(item.metrics?.spend || '0');
          existing.impressions += parseInt(item.metrics?.impressions || '0', 10);
          adMap.set(adId, existing);
        }
      }

      console.log('\n広告別メトリクス:');
      for (const [adId, metrics] of adMap) {
        console.log(`  ${adId}: spend=${metrics.spend}, impressions=${metrics.impressions}`);
      }

      // 対象広告IDを確認
      const targetIds = ['1854091284113730', '1854629506067570'];
      console.log('\n対象広告IDの確認:');
      for (const targetId of targetIds) {
        const found = adMap.has(targetId);
        console.log(`  ${targetId}: ${found ? '見つかった' : '見つからない'}`);
      }
    }
  } catch (error: any) {
    console.error('エラー:', error.response?.data || error.message);
  }

  // 2. 過去7日間のデータを確認
  console.log('\n--- 2. 過去7日間のデータを確認 ---');
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const startDate = sevenDaysAgo.toISOString().split('T')[0];

  try {
    const params = {
      advertiser_id: ADVERTISER_ID,
      dimensions: JSON.stringify(['smart_plus_ad_id']),
      metrics: JSON.stringify(['impressions', 'clicks', 'spend', 'conversion']),
      start_date: startDate,
      end_date: today,
      page: 1,
      page_size: 100,
    };

    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/material_report/overview/`, {
      headers: { 'Access-Token': accessToken },
      params,
    });

    console.log('期間:', startDate, '~', today);
    console.log('レスポンスcode:', response.data.code);
    console.log('データ件数:', response.data.data?.list?.length || 0);

    const list = response.data.data?.list || [];
    if (list.length > 0) {
      console.log('\n広告別メトリクス（過去7日間合計）:');
      for (const item of list.slice(0, 10)) {
        const adId = item.dimensions?.smart_plus_ad_id;
        const spend = item.metrics?.spend || '0';
        const impressions = item.metrics?.impressions || '0';
        console.log(`  ${adId}: spend=${spend}, impressions=${impressions}`);
      }
    }
  } catch (error: any) {
    console.error('エラー:', error.response?.data || error.message);
  }

  // 3. 特定広告IDでフィルタしてメトリクス取得
  console.log('\n--- 3. 特定広告IDでフィルタ ---');
  try {
    const targetIds = ['1854091284113730', '1854629506067570'];
    const params = {
      advertiser_id: ADVERTISER_ID,
      dimensions: JSON.stringify(['smart_plus_ad_id']),
      metrics: JSON.stringify(['impressions', 'clicks', 'spend', 'conversion']),
      start_date: startDate,
      end_date: today,
      filtering: JSON.stringify({ smart_plus_ad_ids: targetIds }),
      page: 1,
      page_size: 100,
    };

    console.log('フィルタ:', JSON.stringify({ smart_plus_ad_ids: targetIds }));

    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/material_report/overview/`, {
      headers: { 'Access-Token': accessToken },
      params,
    });

    console.log('レスポンスcode:', response.data.code);
    console.log('レスポンスmessage:', response.data.message);
    console.log('データ件数:', response.data.data?.list?.length || 0);

    if (response.data.data?.list?.length > 0) {
      console.log('\n結果:');
      for (const item of response.data.data.list) {
        console.log(JSON.stringify(item, null, 2));
      }
    }
  } catch (error: any) {
    console.error('エラー:', error.response?.data || error.message);
  }

  await prisma.$disconnect();
}

main();
