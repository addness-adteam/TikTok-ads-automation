/**
 * アクセストークンからAdvertiser情報を取得して、自動的にDBに登録するスクリプト
 *
 * 使い方:
 * npx tsx scripts/fetch-advertiser-ids.ts <access_token_1> [<access_token_2> ...]
 */

import { PrismaClient } from '../apps/backend/generated/prisma';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

// .envファイルを読み込む
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

const TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api';
const TIKTOK_APP_ID = process.env.TIKTOK_APP_ID;
const TIKTOK_APP_SECRET = process.env.TIKTOK_APP_SECRET;

async function getAdvertiserInfo(accessToken: string) {
  try {
    console.log(`🔍 アクセストークンからAdvertiser情報を取得中...`);
    console.log(`   Token: ${accessToken.substring(0, 10)}...\n`);

    if (!TIKTOK_APP_ID || !TIKTOK_APP_SECRET) {
      throw new Error('TIKTOK_APP_ID と TIKTOK_APP_SECRET が .env ファイルに設定されていません');
    }

    const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/oauth2/advertiser/get/`, {
      headers: {
        'Access-Token': accessToken,
      },
      params: {
        app_id: TIKTOK_APP_ID,
        secret: TIKTOK_APP_SECRET,
      },
    });

    if (response.data.code !== 0) {
      throw new Error(`API Error: ${response.data.message}`);
    }

    const advertiserList = response.data.data?.list || [];

    if (advertiserList.length === 0) {
      console.log('⚠️  このトークンに紐づくAdvertiserが見つかりませんでした\n');
      return [];
    }

    console.log(`✅ ${advertiserList.length}件のAdvertiserが見つかりました:\n`);

    for (const advertiser of advertiserList) {
      console.log(`   📊 Advertiser ID: ${advertiser.advertiser_id}`);
      console.log(`      Name: ${advertiser.advertiser_name || 'N/A'}`);
      console.log(`      Status: ${advertiser.status || 'N/A'}`);
      console.log('');
    }

    return advertiserList;
  } catch (error) {
    if (error.response) {
      console.error('❌ API Error:', error.response.data);
    } else {
      console.error('❌ Error:', error.message);
    }
    throw error;
  }
}

async function saveToken(advertiserId: string, accessToken: string) {
  try {
    // 無期限トークンなので、有効期限を10年後に設定
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 10);

    const result = await prisma.oAuthToken.upsert({
      where: { advertiserId },
      create: {
        advertiserId,
        accessToken,
        refreshToken: null,
        expiresAt,
        scope: null,
      },
      update: {
        accessToken,
        expiresAt,
      },
    });

    console.log(`✅ トークンをデータベースに保存しました`);
    console.log(`   Advertiser ID: ${advertiserId}`);
    console.log(`   有効期限: ${result.expiresAt.toISOString()}\n`);
  } catch (error) {
    console.error(`❌ データベース保存エラー:`, error);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('使い方: npx tsx scripts/fetch-advertiser-ids.ts <access_token_1> [<access_token_2> ...]');
    console.error('');
    console.error('例: npx tsx scripts/fetch-advertiser-ids.ts "token123..." "token456..."');
    process.exit(1);
  }

  console.log('🚀 TikTok Advertiser情報取得 & トークン登録\n');
  console.log('='.repeat(80));
  console.log('');

  let totalAdvertisers = 0;

  for (let i = 0; i < args.length; i++) {
    const accessToken = args[i];

    console.log(`[${i + 1}/${args.length}] アクセストークン処理中`);
    console.log('-'.repeat(80));

    try {
      const advertiserList = await getAdvertiserInfo(accessToken);

      // 各Advertiserに対してトークンを保存
      for (const advertiser of advertiserList) {
        await saveToken(String(advertiser.advertiser_id), accessToken);
        totalAdvertisers++;
      }
    } catch (error) {
      console.error(`⚠️  このトークンはスキップします\n`);
      continue;
    }

    console.log('');
  }

  console.log('='.repeat(80));
  console.log(`\n✅ 完了！合計 ${totalAdvertisers} 件のAdvertiserのトークンを登録しました\n`);

  // 登録されたトークンを確認
  console.log('📊 登録されているトークン一覧:\n');
  const tokens = await prisma.oAuthToken.findMany({
    orderBy: {
      updatedAt: 'desc',
    },
    take: 10,
  });

  for (const token of tokens) {
    const now = new Date();
    const daysUntilExpiry = Math.floor((token.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    console.log(`   - Advertiser ID: ${token.advertiserId}`);
    console.log(`     Token: ${token.accessToken.substring(0, 20)}...`);
    console.log(`     有効期限: あと${daysUntilExpiry}日`);
    console.log('');
  }
}

main()
  .catch((error) => {
    console.error('\n❌ 予期しないエラーが発生しました:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
