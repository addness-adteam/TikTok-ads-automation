/**
 * AdGroupの件数を確認
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';
import axios from 'axios';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  console.log('========================================');
  console.log('AdGroup件数の確認');
  console.log('========================================\n');

  try {
    const oauthTokens = await prisma.oAuthToken.findMany({
      where: { expiresAt: { gt: new Date() } }
    });

    for (const token of oauthTokens) {
      const advertiser = await prisma.advertiser.findUnique({
        where: { tiktokAdvertiserId: token.advertiserId }
      });

      if (!advertiser) continue;

      // APIから全AdGroup数を取得（ページネーションで確認）
      let totalApiAdgroups = 0;
      let page = 1;
      const pageSize = 100;
      let hasMore = true;

      while (hasMore) {
        const response = await axios.get('https://business-api.tiktok.com/open_api/v1.3/adgroup/get/', {
          headers: { 'Access-Token': token.accessToken },
          params: {
            advertiser_id: token.advertiserId,
            page_size: pageSize,
            page: page,
          }
        });

        const list = response.data.data?.list || [];
        totalApiAdgroups += list.length;

        const totalNumber = response.data.data?.page_info?.total_number || 0;
        if (page * pageSize >= totalNumber) {
          hasMore = false;
        } else {
          page++;
        }
      }

      // DBのAdGroup数
      const dbAdgroupCount = await prisma.adGroup.count({
        where: {
          campaign: {
            advertiserId: advertiser.id
          }
        }
      });

      const diff = totalApiAdgroups - dbAdgroupCount;

      if (diff > 0) {
        console.log(`${advertiser.name}:`);
        console.log(`  API: ${totalApiAdgroups}件, DB: ${dbAdgroupCount}件, 差分: ${diff}件`);
      }
    }

    console.log('\n完了');

  } catch (error: any) {
    console.error('エラー:', error.message);
  } finally {
    await app.close();
  }
}

main();
