import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const targetCrs = ['CR00580', 'CR00577', 'CR00574', 'CR00588', 'CR00591', 'CR00585'];

  for (const cr of targetCrs) {
    const ads = await prisma.ad.findMany({
      where: { name: { contains: cr } },
      select: { tiktokId: true, name: true, creativeId: true },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    for (const ad of ads) {
      console.log(`${cr}: ${ad.name} | tiktokId: ${ad.tiktokId} | creativeId: ${ad.creativeId}`);
      if (ad.creativeId) {
        const creative = await prisma.creative.findUnique({ where: { id: ad.creativeId } });
        if (creative) {
          console.log(`  -> creative: ${creative.name} | videoId: ${creative.tiktokVideoId} | imageId: ${creative.tiktokImageId}`);
        }
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
