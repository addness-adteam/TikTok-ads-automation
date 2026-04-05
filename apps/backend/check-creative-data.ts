import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkCreativeData() {
  console.log('🔍 Creativeデータを確認中...\n');

  const creatives = await prisma.creative.findMany({
    where: { type: 'VIDEO' },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });

  console.log(`📊 最新の動画Creative ${creatives.length}件:\n`);

  creatives.forEach((c, i) => {
    console.log(`${i + 1}. ID: ${c.id}`);
    console.log(`   Name: ${c.name}`);
    console.log(`   Type: ${c.type}`);
    console.log(`   TikTok Video ID: ${c.tiktokVideoId}`);
    console.log(`   TikTok Image ID: ${c.tiktokImageId}`);
    console.log(`   Created: ${c.createdAt}`);
    console.log('');
  });

  await prisma.$disconnect();
}

checkCreativeData().catch(console.error);
