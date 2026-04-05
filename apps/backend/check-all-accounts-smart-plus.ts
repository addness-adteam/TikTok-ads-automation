import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

interface ProblemAd {
  smart_plus_ad_id: string;
  ad_name: string;
  operation_status: string;
}

interface AccountResult {
  advertiserId: string;
  advertiserName: string;
  totalSmartPlusAds: number;
  correctCount: number;
  incorrectCount: number;
  activeIncorrectCount: number;
  problemAds: ProblemAd[];
}

async function checkAllAccounts() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  console.log('========================================');
  console.log('全アカウント Smart+広告 ID整合性チェック');
  console.log('========================================\n');

  // 全ての有効なOAuthトークンを取得
  const tokens = await prisma.oAuthToken.findMany({
    where: {
      expiresAt: { gt: new Date() }
    }
  });

  console.log(`有効なトークン数: ${tokens.length}\n`);

  // Advertiser情報を取得
  const advertisers = await prisma.advertiser.findMany({
    include: { appeal: true }
  });

  const advertiserMap = new Map(
    advertisers.map(adv => [adv.tiktokAdvertiserId, adv])
  );

  const results: AccountResult[] = [];
  let totalProblems = 0;
  let totalActiveProblems = 0;

  for (const token of tokens) {
    const advertiser = advertiserMap.get(token.advertiserId);
    const advertiserName = advertiser?.name || `Unknown (${token.advertiserId})`;

    console.log(`\n----------------------------------------`);
    console.log(`【${advertiserName}】`);
    console.log(`Advertiser ID: ${token.advertiserId}`);
    console.log(`----------------------------------------`);

    try {
      // TikTok APIからSmart+広告を取得
      const smartPlusAds = await tiktokService.getAllSmartPlusAds(
        token.advertiserId,
        token.accessToken
      );

      if (!smartPlusAds || smartPlusAds.length === 0) {
        console.log(`  Smart+広告: 0件`);
        results.push({
          advertiserId: token.advertiserId,
          advertiserName,
          totalSmartPlusAds: 0,
          correctCount: 0,
          incorrectCount: 0,
          activeIncorrectCount: 0,
          problemAds: []
        });
        continue;
      }

      console.log(`  Smart+広告: ${smartPlusAds.length}件`);

      let correctCount = 0;
      let incorrectCount = 0;
      const problemAds: ProblemAd[] = [];

      for (const spAd of smartPlusAds) {
        const smartPlusAdId = spAd.smart_plus_ad_id;

        // smart_plus_ad_idでDBを検索
        const adBySmartPlusId = await prisma.ad.findUnique({
          where: { tiktokId: String(smartPlusAdId) }
        });

        if (adBySmartPlusId) {
          correctCount++;
        } else {
          incorrectCount++;
          problemAds.push({
            smart_plus_ad_id: smartPlusAdId,
            ad_name: spAd.ad_name,
            operation_status: spAd.operation_status
          });
        }
      }

      const activeProblems = problemAds.filter(ad => ad.operation_status === 'ENABLE');

      console.log(`  ✓ 正常: ${correctCount}件`);
      console.log(`  ✗ 問題あり: ${incorrectCount}件 (うち配信中: ${activeProblems.length}件)`);

      if (activeProblems.length > 0) {
        console.log(`\n  【配信中で問題のある広告】`);
        activeProblems.forEach((ad, i) => {
          console.log(`    [${i + 1}] ${ad.ad_name}`);
          console.log(`        ID: ${ad.smart_plus_ad_id}`);
        });
      }

      totalProblems += incorrectCount;
      totalActiveProblems += activeProblems.length;

      results.push({
        advertiserId: token.advertiserId,
        advertiserName,
        totalSmartPlusAds: smartPlusAds.length,
        correctCount,
        incorrectCount,
        activeIncorrectCount: activeProblems.length,
        problemAds
      });

    } catch (error: any) {
      console.log(`  ✗ エラー: ${error.message}`);
      results.push({
        advertiserId: token.advertiserId,
        advertiserName,
        totalSmartPlusAds: -1,
        correctCount: 0,
        incorrectCount: 0,
        activeIncorrectCount: 0,
        problemAds: []
      });
    }
  }

  // サマリー
  console.log('\n\n========================================');
  console.log('【サマリー】');
  console.log('========================================\n');

  console.log('アカウント別集計:');
  console.log('─'.repeat(80));
  console.log('アカウント名'.padEnd(35) + '総数'.padStart(6) + '正常'.padStart(6) + '問題'.padStart(6) + '配信中問題'.padStart(10));
  console.log('─'.repeat(80));

  for (const result of results) {
    if (result.totalSmartPlusAds === -1) {
      console.log(`${result.advertiserName.padEnd(35)} エラー`);
    } else if (result.totalSmartPlusAds === 0) {
      console.log(`${result.advertiserName.padEnd(35)} ${'0'.padStart(6)} ${'0'.padStart(6)} ${'0'.padStart(6)} ${'0'.padStart(10)}`);
    } else {
      console.log(
        `${result.advertiserName.substring(0, 33).padEnd(35)} ` +
        `${result.totalSmartPlusAds.toString().padStart(6)} ` +
        `${result.correctCount.toString().padStart(6)} ` +
        `${result.incorrectCount.toString().padStart(6)} ` +
        `${result.activeIncorrectCount.toString().padStart(10)}`
      );
    }
  }

  console.log('─'.repeat(80));
  console.log(`\n合計問題数: ${totalProblems}件`);
  console.log(`配信中の問題数: ${totalActiveProblems}件`);

  // 全問題広告の一覧
  const allProblemAds = results.flatMap(r =>
    r.problemAds.map(ad => ({
      ...ad,
      advertiserName: r.advertiserName
    }))
  );

  const allActiveProblemAds = allProblemAds.filter(ad => ad.operation_status === 'ENABLE');

  if (allActiveProblemAds.length > 0) {
    console.log('\n\n========================================');
    console.log('【配信中で問題のある全広告一覧】');
    console.log('========================================\n');

    allActiveProblemAds.forEach((ad, i) => {
      console.log(`[${i + 1}] ${ad.advertiserName}`);
      console.log(`    広告名: ${ad.ad_name}`);
      console.log(`    smart_plus_ad_id: ${ad.smart_plus_ad_id}`);
      console.log('');
    });
  }

  await app.close();
}

checkAllAccounts();
