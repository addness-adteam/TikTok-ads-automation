import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // AI3のAdvertiser情報を取得
  const ai3Advertiser = await prisma.advertiser.findFirst({
    where: {
      tiktokAdvertiserId: '7543540647266074641'
    }
  });

  if (!ai3Advertiser) {
    console.log('AI3 Advertiser not found');
    return;
  }

  console.log('AI3 Advertiser:', ai3Advertiser.name, ai3Advertiser.tiktokAdvertiserId);

  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);
  const todayStart = new Date(jstNow);
  todayStart.setUTCHours(0, 0, 0, 0);
  todayStart.setTime(todayStart.getTime() - jstOffset);

  // AI3の広告を取得
  const ai3Ads = await prisma.ad.findMany({
    where: {
      adGroup: {
        campaign: {
          advertiserId: ai3Advertiser.id
        }
      }
    },
    select: {
      tiktokId: true,
      name: true,
      status: true
    }
  });

  const ai3AdIds = new Set(ai3Ads.map(ad => ad.tiktokId));
  console.log('\nAI3 total ads in DB:', ai3Ads.length);

  // 今日のPAUSEログでAI3の広告を確認
  const pauseLogs = await prisma.changeLog.findMany({
    where: {
      createdAt: {
        gte: todayStart
      },
      action: 'PAUSE'
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log('\n=== AI3 PAUSE ChangeLog (Today) ===');
  const ai3PauseLogs = pauseLogs.filter(log => ai3AdIds.has(log.entityId));
  console.log('AI3 PAUSE logs:', ai3PauseLogs.length);
  ai3PauseLogs.forEach(log => {
    const ad = ai3Ads.find(a => a.tiktokId === log.entityId);
    console.log('---');
    console.log('Ad ID:', log.entityId);
    console.log('Ad Name:', ad?.name);
    console.log('Current DB Status:', ad?.status);
    console.log('Reason:', log.reason);
    console.log('Time:', log.createdAt);
  });

  // DBでENABLEになっているがPAUSEログがある広告
  console.log('\n=== AI3 Ads: PAUSE logged but still ENABLE in DB ===');
  const pausedButEnabled = ai3PauseLogs.filter(log => {
    const ad = ai3Ads.find(a => a.tiktokId === log.entityId);
    return ad && ad.status === 'ENABLE';
  });
  
  if (pausedButEnabled.length === 0) {
    console.log('None found - All PAUSE logged ads are properly disabled');
  } else {
    console.log('Found', pausedButEnabled.length, 'ads that were PAUSE logged but still ENABLE:');
    pausedButEnabled.forEach(log => {
      const ad = ai3Ads.find(a => a.tiktokId === log.entityId);
      console.log('---');
      console.log('Ad ID:', log.entityId);
      console.log('Ad Name:', ad?.name);
      console.log('PAUSE Reason:', log.reason);
      console.log('PAUSE Time:', log.createdAt);
    });
  }

  // 全てのAI3 ENABLE広告の一覧
  console.log('\n=== AI3 Currently ENABLE Ads ===');
  const enabledAds = ai3Ads.filter(ad => ad.status === 'ENABLE');
  console.log('Total ENABLE ads:', enabledAds.length);
  enabledAds.forEach(ad => {
    console.log('-', ad.tiktokId, ad.name);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
