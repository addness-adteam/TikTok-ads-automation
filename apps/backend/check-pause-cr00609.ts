import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const ads = await prisma.ad.findMany({
    where: { name: { contains: 'CR00609' } },
    select: {
      id: true, tiktokId: true, name: true, status: true, createdAt: true,
      adGroup: { select: { campaign: { select: { advertiserId: true } } } },
    },
  });
  console.log('=== CR00609 広告 ===');
  for (const ad of ads) {
    console.log(`name: ${ad.name} | tiktokId: ${ad.tiktokId} | status: ${ad.status} | advertiser: ${ad.adGroup?.campaign?.advertiserId} | created: ${ad.createdAt}`);
  }
  if (ads.length === 0) { console.log('広告が見つかりません'); await prisma.$disconnect(); return; }
  for (const ad of ads) {
    const logs = await prisma.changeLog.findMany({
      where: { entityId: ad.tiktokId, entityType: 'AD' },
      orderBy: { createdAt: 'desc' }, take: 10,
    });
    console.log(`\n=== ChangeLog for ${ad.tiktokId} ===`);
    if (logs.length === 0) console.log('ChangeLogなし');
    for (const log of logs) {
      console.log(`[${log.createdAt.toISOString()}] ${log.action} | source: ${log.source} | reason: ${log.reason}`);
    }
    const intradayLogs = await prisma.intradayPauseLog.findMany({
      where: { adId: ad.tiktokId },
      orderBy: { createdAt: 'desc' }, take: 5,
    });
    if (intradayLogs.length > 0) {
      console.log(`\n=== IntradayPauseLog ===`);
      for (const log of intradayLogs) {
        console.log(`[${log.pauseDate}] reason: ${log.pauseReason} | spend: ${log.todaySpend} | CPA: ${log.todayCPA} | resumed: ${log.resumed}`);
      }
    }
  }
  await prisma.$disconnect();
}
main().catch(console.error);
