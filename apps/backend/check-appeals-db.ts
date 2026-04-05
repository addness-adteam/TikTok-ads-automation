import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const appeals = await p.appeal.findMany({
    include: { advertisers: { select: { tiktokAdvertiserId: true, name: true } } },
  });
  for (const a of appeals) {
    console.log(`Appeal: ${a.name} | targetCPA: ${a.targetCPA} | cvSheet: ${a.cvSpreadsheetUrl || 'なし'}`);
    for (const adv of a.advertisers) {
      console.log(`  └ ${adv.name} (${adv.tiktokAdvertiserId})`);
    }
  }
  await p.$disconnect();
}
main();
