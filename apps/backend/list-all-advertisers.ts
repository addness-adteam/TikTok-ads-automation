/**
 * 全Advertiserアカウントをリスト
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  console.log('========================================');
  console.log('登録されているAdvertiserアカウント');
  console.log('========================================\n');

  try {
    const advertisers = await prisma.advertiser.findMany({
      include: {
        appeal: true
      }
    });

    advertisers.forEach((adv, i) => {
      console.log(`[${i + 1}] ${adv.name}`);
      console.log(`    Advertiser ID: ${adv.tiktokAdvertiserId}`);
      console.log(`    Appeal: ${adv.appeal?.name || 'なし'}`);
      console.log('');
    });

    console.log(`合計: ${advertisers.length}件`);

  } catch (error: any) {
    console.error('\n❌ エラーが発生しました:');
    console.error(error.message);
  } finally {
    await app.close();
  }
}

bootstrap();
