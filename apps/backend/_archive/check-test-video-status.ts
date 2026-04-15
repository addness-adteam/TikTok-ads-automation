import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkTestVideoStatus() {
  console.log('🔍 テスト動画Creativeのステータスを確認中...\n');

  const testCreativeId = '28434c3c-d563-4bf9-b237-f1f79bea1bc7';

  const creative = await prisma.creative.findUnique({
    where: { id: testCreativeId },
  });

  if (!creative) {
    console.error('❌ Creative not found');
    await prisma.$disconnect();
    return;
  }

  console.log('📊 Creative情報:');
  console.log(`  ID: ${creative.id}`);
  console.log(`  Name: ${creative.name}`);
  console.log(`  Type: ${creative.type}`);
  console.log(`  Video ID: ${creative.tiktokVideoId}`);
  console.log(`  Thumbnail Image ID: ${creative.tiktokImageId || '❌ まだ設定されていません'}`);
  console.log('');

  if (creative.tiktokImageId) {
    console.log('✅ サムネイル画像IDが設定されています！テスト実行可能です。');
  } else {
    console.log('⏳ まだサムネイル画像IDが設定されていません。バックグラウンドスクリプトの処理を待つ必要があります。');
  }

  await prisma.$disconnect();
}

checkTestVideoStatus().catch(console.error);
