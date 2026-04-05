import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function listImages() {
  const images = await prisma.creative.findMany({
    where: { type: 'IMAGE' },
    select: {
      id: true,
      name: true,
      width: true,
      height: true,
      tiktokImageId: true,
    },
  });

  console.log('All Image Creatives:\n');
  images.forEach((img, i) => {
    const aspectRatio = img.width && img.height ? img.width / img.height : null;
    const is916 = aspectRatio ? Math.abs(aspectRatio - (9/16)) < 0.01 : false;

    console.log(`${i + 1}. ${img.name}`);
    console.log(`   ID: ${img.id}`);
    console.log(`   TikTok Image ID: ${img.tiktokImageId}`);
    console.log(`   Dimensions: ${img.width}x${img.height}`);
    if (aspectRatio) {
      const ratioStr = is916 ? '9:16 ✅' : aspectRatio > 1 ? `${aspectRatio.toFixed(2)}:1` : `1:${(1/aspectRatio).toFixed(2)}`;
      console.log(`   Aspect Ratio: ${ratioStr}`);
    }
    console.log('');
  });

  await prisma.$disconnect();
}

listImages().catch(console.error);
