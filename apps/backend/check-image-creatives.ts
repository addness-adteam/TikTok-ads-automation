import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkImageCreatives() {
  console.log('🔍 画像Creativeを確認中...\n');

  const images = await prisma.creative.findMany({
    where: { type: 'IMAGE' },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  console.log(`📊 画像Creative ${images.length}件:\n`);

  if (images.length === 0) {
    console.log('⚠️  画像Creativeがありません\n');
    console.log('💡 動画広告にはサムネイル画像が必要です。画像をアップロードしてください。');
  } else {
    images.forEach((c, i) => {
      console.log(`${i + 1}. ID: ${c.id}`);
      console.log(`   Name: ${c.name}`);
      console.log(`   TikTok Image ID: ${c.tiktokImageId}`);
      console.log(`   Created: ${c.createdAt}`);
      console.log('');
    });

    console.log('💡 これらの画像IDを動画広告のサムネイルとして使用できます');
  }

  await prisma.$disconnect();
}

checkImageCreatives().catch(console.error);
