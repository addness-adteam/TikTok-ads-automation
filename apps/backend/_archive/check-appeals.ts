import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  const appeals = await prisma.appeal.findMany({
    include: {
      advertisers: {
        select: {
          name: true,
          tiktokAdvertiserId: true,
        },
      },
    },
  });

  console.log('=== 訴求一覧 ===\n');
  for (const appeal of appeals) {
    console.log(`訴求名: ${appeal.name}`);
    console.log(`  CVスプレッドシート: ${appeal.cvSpreadsheetUrl}`);
    console.log(`  広告主:`);
    for (const adv of appeal.advertisers) {
      console.log(`    - ${adv.name} (${adv.tiktokAdvertiserId})`);
    }
    console.log('');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
