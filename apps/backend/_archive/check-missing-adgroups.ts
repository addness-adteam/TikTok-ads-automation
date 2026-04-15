import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

/**
 * 見つからなかったAdGroupを確認
 */
async function checkMissingAdgroups() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  const advertiserId = '7543540647266074641'; // AI_3
  const missingAdgroupIds = [
    '1843210101863585',
    '1847308332468274',
    '1846390462988322',
  ];

  console.log('========================================');
  console.log('Missing AdGroups Check');
  console.log('========================================\n');

  const token = await prisma.oAuthToken.findFirst({
    where: {
      advertiserId,
      expiresAt: { gt: new Date() },
    },
  });

  if (!token) {
    console.log('X No valid token found');
    await app.close();
    return;
  }

  // 通常のAdGroup取得APIで取得できるか確認
  console.log('Checking if these AdGroups can be retrieved via /v1.3/adgroup/get/...\n');

  try {
    const adgroupsResponse = await tiktokService.getAdGroups(
      advertiserId,
      token.accessToken,
    );

    const allAdgroups = adgroupsResponse.data?.list || [];
    console.log(`Total AdGroups retrieved: ${allAdgroups.length}\n`);

    for (const adgroupId of missingAdgroupIds) {
      const found = allAdgroups.find((ag: any) => ag.adgroup_id === adgroupId);

      if (found) {
        console.log(`V AdGroup ${adgroupId} FOUND in API response`);
        console.log(`  Name: ${found.adgroup_name}`);
        console.log(`  Status: ${found.operation_status}`);
        console.log(`  Campaign: ${found.campaign_id}`);
      } else {
        console.log(`X AdGroup ${adgroupId} NOT FOUND in API response`);
      }
      console.log('');
    }

    // DBにあるかも確認
    console.log('Checking database...\n');
    for (const adgroupId of missingAdgroupIds) {
      const dbAdgroup = await prisma.adGroup.findUnique({
        where: { tiktokId: adgroupId },
      });

      if (dbAdgroup) {
        console.log(`V AdGroup ${adgroupId} EXISTS in DB`);
        console.log(`  Name: ${dbAdgroup.name}`);
      } else {
        console.log(`X AdGroup ${adgroupId} NOT in DB`);
      }
    }

  } catch (error: any) {
    console.log(`X Error: ${error.message}`);
  }

  await app.close();
}

checkMissingAdgroups();
