/**
 * データベースに登録されているTikTokアクセストークンを確認するスクリプト
 *
 * 使い方:
 * npx tsx scripts/check-tokens.ts
 */

import { PrismaClient } from '../apps/backend/generated/prisma';

const prisma = new PrismaClient();

async function checkTokens() {
  try {
    console.log('🔍 データベース接続を確認しています...\n');

    // データベース接続テスト
    await prisma.$connect();
    console.log('✅ データベースに接続しました\n');

    // 登録されているトークンを取得
    const tokens = await prisma.oAuthToken.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (tokens.length === 0) {
      console.log('⚠️  登録されているトークンはありません\n');
      console.log('トークンを登録するには:');
      console.log('npx tsx scripts/add-tokens.ts <advertiser_id> <access_token>');
      return;
    }

    console.log(`📊 登録されているトークン: ${tokens.length}件\n`);
    console.log('='.repeat(80));

    for (const [index, token] of tokens.entries()) {
      console.log(`\n[${index + 1}] トークン情報`);
      console.log('-'.repeat(80));
      console.log(`  ID:                ${token.id}`);
      console.log(`  Advertiser ID:     ${token.advertiserId}`);
      console.log(`  Access Token:      ${token.accessToken.substring(0, 20)}...`);
      console.log(`  Refresh Token:     ${token.refreshToken ? token.refreshToken.substring(0, 20) + '...' : 'なし'}`);
      console.log(`  有効期限:          ${token.expiresAt.toISOString()}`);
      console.log(`  Scope:             ${token.scope || 'なし'}`);
      console.log(`  作成日時:          ${token.createdAt.toISOString()}`);
      console.log(`  更新日時:          ${token.updatedAt.toISOString()}`);

      // 有効期限チェック
      const now = new Date();
      const daysUntilExpiry = Math.floor((token.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (token.expiresAt < now) {
        console.log(`  ステータス:        ❌ 期限切れ`);
      } else if (daysUntilExpiry < 30) {
        console.log(`  ステータス:        ⚠️  まもなく期限切れ (残り${daysUntilExpiry}日)`);
      } else {
        console.log(`  ステータス:        ✅ 有効 (残り${daysUntilExpiry}日)`);
      }
    }

    console.log('\n' + '='.repeat(80));

    // キャンペーン数も確認
    const campaigns = await prisma.campaign.findMany();
    console.log(`\n📊 登録されているキャンペーン: ${campaigns.length}件`);

    if (campaigns.length > 0) {
      console.log('\nキャンペーン一覧:');
      for (const campaign of campaigns) {
        console.log(`  - ${campaign.name} (ID: ${campaign.tiktokId}, Status: ${campaign.status})`);
      }
    }

  } catch (error) {
    if (error.code === 'P1001') {
      console.error('❌ データベースに接続できません');
      console.error('');
      console.error('以下を確認してください:');
      console.error('1. Docker Desktopが起動していますか？');
      console.error('2. データベースコンテナが起動していますか？');
      console.error('   → docker-compose up -d');
      console.error('3. .envファイルのDATABASE_URLは正しいですか？');
    } else if (error.code === 'P2021') {
      console.error('❌ テーブルが存在しません');
      console.error('');
      console.error('マイグレーションを実行してください:');
      console.error('  cd apps/backend');
      console.error('  npx prisma migrate dev');
    } else {
      console.error('❌ エラーが発生しました:', error);
    }
    process.exit(1);
  }
}

async function main() {
  await checkTokens();
}

main()
  .catch((error) => {
    console.error('予期しないエラーが発生しました:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
