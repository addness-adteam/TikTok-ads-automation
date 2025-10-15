/**
 * TikTok アクセストークンをデータベースに登録するスクリプト
 *
 * 使い方:
 * npx tsx scripts/add-tokens.ts <advertiser_id_1> <access_token_1> [<advertiser_id_2> <access_token_2>]
 */

import { PrismaClient } from '../apps/backend/generated/prisma';

const prisma = new PrismaClient();

async function addToken(advertiserId: string, accessToken: string) {
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

    console.log(`✅ トークンを登録しました: Advertiser ID = ${advertiserId}`);
    console.log(`   - ID: ${result.id}`);
    console.log(`   - 有効期限: ${result.expiresAt.toISOString()}`);
    console.log(`   - 作成日時: ${result.createdAt.toISOString()}`);
    console.log('');
  } catch (error) {
    console.error(`❌ エラー: Advertiser ID = ${advertiserId}`, error);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.length % 2 !== 0) {
    console.error('使い方: npx tsx scripts/add-tokens.ts <advertiser_id_1> <access_token_1> [<advertiser_id_2> <access_token_2>]');
    console.error('例: npx tsx scripts/add-tokens.ts "1234567890" "act.abc123..." "0987654321" "act.xyz789..."');
    process.exit(1);
  }

  console.log('🔄 TikTok アクセストークンを登録しています...\n');

  // ペアごとにトークンを登録
  for (let i = 0; i < args.length; i += 2) {
    const advertiserId = args[i];
    const accessToken = args[i + 1];
    await addToken(advertiserId, accessToken);
  }

  console.log('✅ すべてのトークンの登録が完了しました！');
}

main()
  .catch((error) => {
    console.error('エラーが発生しました:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
