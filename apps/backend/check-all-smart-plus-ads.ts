import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

async function check() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  console.log('========================================');
  console.log('全Smart+広告のID整合性チェック');
  console.log('========================================\n');

  // AI1のトークンを取得
  const token = await prisma.oAuthToken.findFirst({
    where: {
      advertiserId: '7468288053866561553',
      expiresAt: { gt: new Date() }
    }
  });

  if (!token) {
    console.log('トークンが見つかりません');
    await app.close();
    return;
  }

  // TikTok APIからSmart+広告を取得
  const smartPlusResponse = await tiktokService.getAllSmartPlusAds(
    token.advertiserId,
    token.accessToken
  );

  const smartPlusAds = smartPlusResponse || [];
  console.log(`TikTok APIから取得したSmart+広告数: ${smartPlusAds.length}\n`);

  let correctCount = 0;
  let incorrectCount = 0;
  const incorrectAds: any[] = [];

  for (const spAd of smartPlusAds) {
    const smartPlusAdId = spAd.smart_plus_ad_id;
    const adName = spAd.ad_name;

    // smart_plus_ad_idでDBを検索
    const adBySmartPlusId = await prisma.ad.findUnique({
      where: { tiktokId: String(smartPlusAdId) }
    });

    if (adBySmartPlusId) {
      correctCount++;
    } else {
      incorrectCount++;
      incorrectAds.push({
        smart_plus_ad_id: smartPlusAdId,
        ad_name: adName,
        operation_status: spAd.operation_status
      });
    }
  }

  console.log('【結果】');
  console.log(`  ✓ 正しくsmart_plus_ad_idで登録: ${correctCount}件`);
  console.log(`  ✗ smart_plus_ad_idで見つからない: ${incorrectCount}件\n`);

  if (incorrectAds.length > 0) {
    console.log('【問題のある広告一覧】');
    incorrectAds.forEach((ad, i) => {
      console.log(`  [${i + 1}] ${ad.smart_plus_ad_id}`);
      console.log(`      名前: ${ad.ad_name}`);
      console.log(`      ステータス: ${ad.operation_status}`);
    });
  }

  // 配信中の広告のみ抽出
  const activeIncorrectAds = incorrectAds.filter(ad => ad.operation_status === 'ENABLE');
  console.log(`\n【配信中で問題のある広告】: ${activeIncorrectAds.length}件`);
  activeIncorrectAds.forEach((ad, i) => {
    console.log(`  [${i + 1}] ${ad.ad_name}`);
  });

  await app.close();
}
check();
