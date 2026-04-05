// OAuthTokenテーブルを確認するスクリプト
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkOAuthTokens() {
  console.log('=== OAuthTokenテーブルの確認 ===\n');

  const tokens = await prisma.oAuthToken.findMany({
    select: {
      id: true,
      advertiserId: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
      scope: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  console.log(`OAuthトークン数: ${tokens.length}\n`);

  if (tokens.length === 0) {
    console.log('⚠️ OAuthトークンが1つもありません！');
    console.log('これがAD単位のメトリクスが保存されない根本原因です。\n');
    console.log('原因の可能性:');
    console.log('1. OAuthトークンが未登録');
    console.log('2. トークンが削除された');
    console.log('3. データベースのマイグレーションで削除された\n');
    console.log('解決方法:');
    console.log('1. TikTok広告アカウントと再連携する');
    console.log('2. POST /auth/tiktok/save でトークンを保存する');
  } else {
    tokens.forEach((token) => {
      console.log(`トークンID: ${token.id}`);
      console.log(`  広告主ID: ${token.advertiserId}`);
      console.log(`  アクセストークン: ${token.accessToken ? token.accessToken.substring(0, 20) + '...' : 'なし'}`);
      console.log(`  有効期限: ${token.expiresAt ? token.expiresAt.toISOString() : '不明'}`);
      console.log(`  作成日: ${token.createdAt.toISOString()}`);
      console.log(`  更新日: ${token.updatedAt.toISOString()}`);
      console.log();
    });

    // トークンの広告主IDとCampaignの広告主IDを比較
    console.log('=== トークンの広告主IDとCampaignの広告主IDの比較 ===\n');

    const campaigns = await prisma.campaign.findMany({
      select: {
        advertiserId: true,
      },
      distinct: ['advertiserId'],
    });

    const campaignAdvIds = campaigns.map((c) => c.advertiserId);
    const tokenAdvIds = tokens.map((t) => t.advertiserId);

    console.log(`Campaignの広告主ID（${campaignAdvIds.length}件）:`);
    campaignAdvIds.slice(0, 3).forEach((id) => console.log(`  ${id}`));
    console.log();

    console.log(`Tokenの広告主ID（${tokenAdvIds.length}件）:`);
    tokenAdvIds.slice(0, 3).forEach((id) => console.log(`  ${id}`));
    console.log();

    // 一致する広告主IDをチェック
    const matchingIds = tokenAdvIds.filter((id) => campaignAdvIds.includes(id));
    console.log(`一致する広告主ID: ${matchingIds.length}件`);

    if (matchingIds.length === 0) {
      console.log('⚠️ トークンの広告主IDとCampaignの広告主IDが1つも一致しません！');
      console.log('これがメトリクス取得とエンティティ同期が失敗する原因です。\n');
      console.log('原因:');
      console.log('- OAuthTokenテーブルのadvertiserIdがUUID形式');
      console.log('- CampaignテーブルのadvertiserIdもUUID形式');
      console.log('- しかし、異なるUUIDが使われている\n');
      console.log('解決方法:');
      console.log('- データベースのスキーマとデータの整合性を確認');
      console.log('- トークンと広告主の紐付けロジックを確認');
    }
  }

  await prisma.$disconnect();
}

checkOAuthTokens().catch((error) => {
  console.error(error);
  process.exit(1);
});
