/**
 * アクセストークンに紐付いているAdvertiser IDを確認するスクリプト
 *
 * 使い方:
 * 1. トークンをこのファイルの下部に記入
 * 2. npx ts-node scripts/check-token-advertisers.ts
 */

import axios from 'axios';

const APP_ID = '7425566849489747984';
const APP_SECRET = 'fb6b33ca782f0b1f0874e5ac6cc5669a636fa8af';
const BASE_URL = 'https://business-api.tiktok.com/open_api';

async function checkTokenAdvertisers(accessToken: string, tokenLabel: string) {
  try {
    console.log(`\n=== ${tokenLabel} ===`);
    console.log(`トークン: ${accessToken.substring(0, 20)}...`);

    const response = await axios.get(`${BASE_URL}/v1.3/oauth2/advertiser/get/`, {
      headers: {
        'Access-Token': accessToken,
      },
      params: {
        app_id: APP_ID,
        secret: APP_SECRET,
      },
    });

    if (response.data.code === 0) {
      const advertisers = response.data.data.list || [];
      console.log(`\n✅ このトークンでアクセスできる広告アカウント数: ${advertisers.length}個`);

      advertisers.forEach((adv: any, index: number) => {
        console.log(`\n  ${index + 1}. Advertiser ID: ${adv.advertiser_id}`);
        console.log(`     名前: ${adv.advertiser_name || 'N/A'}`);
        console.log(`     ステータス: ${adv.status || 'N/A'}`);
      });

      return advertisers.map((adv: any) => adv.advertiser_id);
    } else {
      console.error(`❌ エラー: ${response.data.message}`);
      return [];
    }
  } catch (error: any) {
    console.error(`❌ API呼び出しエラー:`, error.response?.data || error.message);
    return [];
  }
}

async function main() {
  // ここに2つのトークンを記入してください
  const TOKEN_1 = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
  const TOKEN_2 = '1cefc5a8c8d32e0bf1ac21b2abb7d2a688bb1410';

  console.log('='.repeat(60));
  console.log('TikTok アクセストークン - Advertiser確認ツール');
  console.log('='.repeat(60));

  const advertisers1 = await checkTokenAdvertisers(TOKEN_1, 'トークン1');
  const advertisers2 = await checkTokenAdvertisers(TOKEN_2, 'トークン2');

  console.log('\n' + '='.repeat(60));
  console.log('サマリー');
  console.log('='.repeat(60));
  console.log(`トークン1: ${advertisers1.length}個の広告アカウント`);
  console.log(`トークン2: ${advertisers2.length}個の広告アカウント`);
  console.log(`合計: ${advertisers1.length + advertisers2.length}個の広告アカウントにアクセス可能`);
  console.log('='.repeat(60));
}

main();
