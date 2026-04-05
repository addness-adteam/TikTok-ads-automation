import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

/**
 * Smart+ 広告の完全なAPIレスポンスを確認
 */
async function checkSmartPlusFullResponse() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  const advertiserId = '7543540647266074641'; // AI_3

  console.log('========================================');
  console.log('Smart+ Ads - Full API Response Check');
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
    const smartPlusAdsResult = await tiktokService.getSmartPlusAds(
      advertiserId,
      token.accessToken,
    );

    const smartPlusAds = smartPlusAdsResult.data?.list || [];
    console.log(`Retrieved ${smartPlusAds.length} Smart+ ads\n`);

    if (smartPlusAds.length > 0) {
      console.log('========================================');
      console.log('FULL RESPONSE of First Smart+ Ad:');
      console.log('========================================\n');
      console.log(JSON.stringify(smartPlusAds[0], null, 2));

      console.log('\n========================================');
      console.log('All Field Names in First Smart+ Ad:');
      console.log('========================================\n');
      const fieldNames = Object.keys(smartPlusAds[0]);
      fieldNames.forEach((field, index) => {
        const value = smartPlusAds[0][field];
        const type = Array.isArray(value) ? 'array' : typeof value;
        const preview = Array.isArray(value)
          ? `[${value.length} items]`
          : typeof value === 'object' && value !== null
            ? '{...}'
            : String(value).length > 50
              ? String(value).substring(0, 50) + '...'
              : String(value);
        console.log(`${index + 1}. ${field} (${type}): ${preview}`);
      });

      // 特に creative に関連しそうなフィールドを探す
      console.log('\n========================================');
      console.log('Creative-related Fields:');
      console.log('========================================\n');
      const creativeFields = fieldNames.filter(field =>
        field.toLowerCase().includes('creative') ||
        field.toLowerCase().includes('video') ||
        field.toLowerCase().includes('image') ||
        field.toLowerCase().includes('media') ||
        field.toLowerCase().includes('material') ||
        field.toLowerCase().includes('asset')
      );

      if (creativeFields.length > 0) {
        creativeFields.forEach(field => {
          console.log(`${field}:`, JSON.stringify(smartPlusAds[0][field], null, 2));
        });
      } else {
        console.log('No obvious creative-related fields found');
      }
    }

  } catch (error: any) {
    console.log(`X Error: ${error.message}`);
    if (error.response) {
      console.log('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }

  await app.close();
}

checkSmartPlusFullResponse();
