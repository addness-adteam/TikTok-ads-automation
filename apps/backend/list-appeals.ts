import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { PrismaClient } from '@prisma/client';

async function main() {
  const p = new PrismaClient();
  const all = await p.appeal.findMany();
  for (const a of all) {
    console.log(`${a.name}:`);
    console.log(`  cvSpreadsheetUrl: ${(a as any).cvSpreadsheetUrl}`);
    console.log(`  frontSpreadsheetUrl: ${(a as any).frontSpreadsheetUrl}`);
    console.log(`  cvSheetName: ${(a as any).cvSheetName}`);
    console.log(`  frontSheetNames: ${(a as any).frontSheetNames}`);
    console.log(`  targetCPA=${a.targetCPA} targetFrontCPO=${(a as any).targetFrontCPO}`);
  }
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
