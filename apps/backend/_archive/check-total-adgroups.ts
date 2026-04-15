import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

/**
 * AI_3アカウントの全AdGroup数を確認
 */
async function checkTotalAdgroups() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('Total AdGroups Check for AI_3');
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

  try {
    const response = await tiktokService.getAdGroups(
      advertiserId,
      token.accessToken,
    );

    console.log('API Response page_info:', JSON.stringify(response.data?.page_info, null, 2));
    console.log('');

    const adgroups = response.data?.list || [];
    const pageInfo = response.data?.page_info;

    console.log(`Retrieved AdGroups: ${adgroups.length}`);
    console.log(`Total AdGroups (from page_info): ${pageInfo?.total_number || 'N/A'}`);
    console.log(`Page: ${pageInfo?.page || 'N/A'}`);
    console.log(`Page Size: ${pageInfo?.page_size || 'N/A'}`);
    console.log(`Total Page: ${pageInfo?.total_page || 'N/A'}`);

    if (pageInfo?.total_number && pageInfo.total_number > 100) {
      console.log('\n! WARNING: Total AdGroups exceeds page_size of 100!');
      console.log(`  Missing AdGroups: ${pageInfo.total_number - 100}`);
      console.log('  This explains why Smart+ ads are not being synced!');
    }

  } catch (error: any) {
    console.log(`X Error: ${error.message}`);
  }

  await app.close();
}

checkTotalAdgroups();
