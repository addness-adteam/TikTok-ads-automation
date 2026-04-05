import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();
const p = new PrismaClient();

async function main() {
  const targets = [
    { label: 'LP2-CR00230 (AI_2)', pattern: 'LP2-CR00230', accId: '7523128243466551303' },
    { label: 'LP1-CR00619 (SNS_2)', pattern: 'LP1-CR00619', accId: '7543540100849156112' },
    { label: 'LP2-CR00468 (SP1)', pattern: 'LP2-CR00468', accId: '7474920444831875080' },
    { label: 'LP2-CR00494 (SP1)', pattern: 'LP2-CR00494', accId: '7474920444831875080' },
    { label: 'LP2-CR00511 (SP2)', pattern: 'LP2-CR00511', accId: '7592868952431362066' },
  ];

  for (const t of targets) {
    const ads = await p.$queryRaw<any[]>`
      SELECT a."tiktokId", a.name, a.status
      FROM ads a
      JOIN adgroups ag ON a."adgroupId" = ag.id
      JOIN campaigns c ON ag."campaignId" = c.id
      JOIN advertisers adv ON c."advertiserId" = adv.id
      WHERE adv."tiktokAdvertiserId" = ${t.accId}
        AND a.name LIKE ${'%' + t.pattern}
    `;
    console.log(`\n${t.label}:`);
    for (const a of ads) {
      console.log(`  ${a.tiktokId} | ${a.status} | ${a.name}`);
    }
  }
  await p.$disconnect();
}
main();
