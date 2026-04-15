import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // AI1, AI2の全CR01207をDB検索
  const ads = await prisma.$queryRawUnsafe(`
    SELECT a.name, a."tiktokId", a.status, ag.name as adgroup_name, c.name as campaign_name,
           adv."tiktokAdvertiserId", adv.name as adv_name, a."createdAt"
    FROM ads a
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    JOIN advertisers adv ON c."advertiserId" = adv.id
    WHERE a.name LIKE '%CR01207%'
    ORDER BY adv."tiktokAdvertiserId", a."createdAt"
  `) as any[];

  console.log(`=== All ads with CR01207 (${ads.length}) ===`);
  for (const a of ads) {
    console.log(`[${a.adv_name}] ${a.tiktokAdvertiserId}`);
    console.log(`  ad: ${a.tiktokId} | ${a.name} | status: ${a.status}`);
    console.log(`  campaign: ${a.campaign_name}`);
    console.log(`  adgroup: ${a.adgroup_name}`);
    console.log(`  created: ${a.createdAt}`);
    console.log('');
  }

  // cross_deploy_logsからCR01207関連を検索
  const deployLogs = await prisma.$queryRawUnsafe(`
    SELECT * FROM cross_deploy_logs
    WHERE "adName" LIKE '%CR01207%' OR "adName" LIKE '%CR454%'
    ORDER BY "createdAt" DESC
  `) as any[];

  console.log(`=== CrossDeployLogs (${deployLogs.length}) ===`);
  for (const l of deployLogs) {
    console.log(`${l.createdAt} | ${l.sourceAdvertiserId} -> ${l.targetAdvertiserId}`);
    console.log(`  adName: ${l.adName} | newAdId: ${l.newAdId} | status: ${l.status}`);
    console.log('');
  }

  await prisma.$disconnect();
}
main().catch(console.error);
