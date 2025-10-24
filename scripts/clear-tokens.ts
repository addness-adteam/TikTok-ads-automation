/**
 * データベースのトークンをすべて削除するスクリプト
 */

import { PrismaClient } from '../apps/backend/generated/prisma';

const prisma = new PrismaClient();

async function main() {
  console.log('🗑️  すべてのトークンを削除しています...\n');

  const result = await prisma.oAuthToken.deleteMany({});

  console.log(`✅ ${result.count}件のトークンを削除しました\n`);
}

main()
  .catch((error) => {
    console.error('エラーが発生しました:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
