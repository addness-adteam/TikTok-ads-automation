import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { SchedulerService } from './src/jobs/scheduler.service';

/**
 * 修正されたSmart+広告同期をテスト
 */
async function testFixedSmartPlusSync() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const schedulerService = app.get(SchedulerService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('Testing Fixed Smart+ Ads Sync');
  console.log('========================================\n');

  // 修正前のSmart+広告数を確認
  const advertiser = await prisma.advertiser.findFirst({
    where: { tiktokAdvertiserId: advertiserId },
  });

  if (!advertiser) {
    console.log('X Advertiser not found');
    await app.close();
    return;
  }

  const beforeCount = await prisma.ad.count({
    where: {
      adGroup: {
        campaign: {
          advertiserId: advertiser.id,
        },
      },
      name: {
        contains: '/',
      },
    },
  });

  console.log(`Smart+ format ads before sync: ${beforeCount}\n`);

  try {
    // Sync を実行
    console.log('Running entity synchronization...\n');
    await schedulerService.scheduleDailyEntitySync();

    console.log('\nSync completed!\n');

    // 修正後のSmart+広告数を確認
    const afterCount = await prisma.ad.count({
      where: {
        adGroup: {
          campaign: {
            advertiserId: advertiser.id,
          },
        },
        name: {
          contains: '/',
        },
      },
    });

    console.log(`Smart+ format ads after sync: ${afterCount}`);
    console.log(`New ads synced: ${afterCount - beforeCount}\n`);

    // サンプルを表示
    const sampleAds = await prisma.ad.findMany({
      where: {
        adGroup: {
          campaign: {
            advertiserId: advertiser.id,
          },
        },
        name: {
          contains: '/',
        },
      },
      include: {
        adGroup: {
          include: {
            campaign: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });

    console.log('Sample synced Smart+ ads:');
    sampleAds.forEach((ad, index) => {
      console.log(`\n[${index + 1}] ${ad.tiktokId}`);
      console.log(`    Name: ${ad.name}`);
      console.log(`    Status: ${ad.status}`);
      console.log(`    CTA: ${ad.callToAction || 'N/A'}`);
      console.log(`    Landing Page: ${ad.landingPageUrl ? 'Set' : 'Not set'}`);
      console.log(`    Updated: ${ad.updatedAt.toISOString()}`);
    });

  } catch (error: any) {
    console.log(`\nX Error: ${error.message}`);
    if (error.stack) {
      console.log(error.stack);
    }
  }

  await app.close();
}

testFixedSmartPlusSync();
