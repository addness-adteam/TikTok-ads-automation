/**
 * 広告名のサンプルを確認するスクリプト
 * 各アカウントの広告名パターンを調査
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { TiktokService } from './src/tiktok/tiktok.service';
import { PrismaService } from './src/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const tiktokService = app.get(TiktokService);
  const prisma = app.get(PrismaService);

  // 検索対象のアカウント情報
  const accounts = [
    { name: 'SNS_1', advertiserId: '7247073333517238273' },
    { name: 'AI_1', advertiserId: '7468288053866561553' },
  ];

  console.log('='.repeat(80));
  console.log('TikTok API 広告名サンプル確認');
  console.log('='.repeat(80));

  for (const account of accounts) {
    console.log(`\n[${'='.repeat(76)}]`);
    console.log(`  アカウント: ${account.name} (${account.advertiserId})`);
    console.log(`[${'='.repeat(76)}]`);

    try {
      // アクセストークンを取得
      const tokenRecord = await prisma.oAuthToken.findUnique({
        where: { advertiserId: account.advertiserId },
      });

      if (!tokenRecord) {
        console.log(`  ❌ アクセストークンが見つかりません`);
        continue;
      }

      // 広告を取得（1ページ目のみ = 100件）
      console.log(`  📡 広告を取得中...`);
      const response = await tiktokService.getAds(
        account.advertiserId,
        tokenRecord.accessToken,
      );

      const ads = response?.data?.list || [];
      console.log(`  📊 取得した広告数: ${ads.length}`);

      // 最新の20件の広告名を表示
      console.log(`\n  広告名サンプル (最新20件):`);
      const sampleSize = Math.min(20, ads.length);

      for (let i = 0; i < sampleSize; i++) {
        const ad = ads[i];
        console.log(`    ${(i + 1).toString().padStart(2, ' ')}. ${ad.ad_name} (ID: ${ad.ad_id})`);
      }

      // 特定のキーワードに近い名前を検索
      console.log(`\n  「CR」「高橋」「251204」を含む広告名を検索:`);
      const keywords = ['CR', '高橋', '251204'];

      for (const keyword of keywords) {
        const matches = ads.filter((ad: any) =>
          ad.ad_name && ad.ad_name.includes(keyword)
        );

        if (matches.length > 0) {
          console.log(`\n    「${keyword}」を含む広告: ${matches.length}件`);
          matches.slice(0, 10).forEach((ad: any, idx: number) => {
            console.log(`      ${idx + 1}. ${ad.ad_name}`);
          });
        } else {
          console.log(`    「${keyword}」を含む広告: なし`);
        }
      }

    } catch (error: any) {
      console.error(`  ❌ エラー: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('完了');
  console.log('='.repeat(80));

  await app.close();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
