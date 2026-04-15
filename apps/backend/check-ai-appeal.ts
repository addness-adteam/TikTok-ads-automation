import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';
async function main() {
  const prisma = new PrismaClient();
  const appeal = await prisma.appeal.findFirst({ where: { name: 'AI' } });
  console.log(JSON.stringify(appeal, null, 2));
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1);});
