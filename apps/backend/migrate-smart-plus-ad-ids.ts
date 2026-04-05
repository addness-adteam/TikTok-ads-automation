import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

/**
 * Smart+広告のtiktokIdをad_idからsmart_plus_ad_idに移行するスクリプト
 *
 * 問題:
 * - DBにはad_idでSmart+広告が登録されている
 * - 予算調整ではsmart_plus_ad_idで検索するため、マッチしない
 * - 広告名もクリエイティブ名になっており、正しい手動設定名に更新が必要
 *
 * このスクリプトが行うこと:
 * 1. TikTok APIからSmart+広告一覧を取得
 * 2. ad_idとsmart_plus_ad_idのマッピングを作成
 * 3. DBのtiktokIdをad_id→smart_plus_ad_idに更新
 * 4. 広告名を正しい手動設定名に更新
 * 5. 古いad_idのレコードがあれば削除（重複防止）
 */

interface MigrationResult {
  advertiserId: string;
  advertiserName: string;
  totalChecked: number;
  migrated: number;
  skipped: number;
  errors: number;
  details: MigrationDetail[];
}

interface MigrationDetail {
  oldTiktokId: string;
  newTiktokId: string;
  oldName: string;
  newName: string;
  status: 'migrated' | 'skipped' | 'error';
  reason?: string;
}

async function migrateSmartPlusAdIds(dryRun: boolean = true) {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  console.log('========================================');
  console.log('Smart+広告 tiktokId マイグレーション');
  console.log(`モード: ${dryRun ? 'DRY RUN（実際の変更なし）' : '本番実行'}`);
  console.log('========================================\n');

  // 全ての有効なOAuthトークンを取得
  const tokens = await prisma.oAuthToken.findMany({
    where: {
      expiresAt: { gt: new Date() }
    }
  });

  // Advertiser情報を取得
  const advertisers = await prisma.advertiser.findMany();
  const advertiserMap = new Map(
    advertisers.map(adv => [adv.tiktokAdvertiserId, adv])
  );

  const results: MigrationResult[] = [];
  let totalMigrated = 0;
  let totalErrors = 0;

  for (const token of tokens) {
    const advertiser = advertiserMap.get(token.advertiserId);
    const advertiserName = advertiser?.name || `Unknown (${token.advertiserId})`;

    console.log(`\n----------------------------------------`);
    console.log(`【${advertiserName}】`);
    console.log(`----------------------------------------`);

    const result: MigrationResult = {
      advertiserId: token.advertiserId,
      advertiserName,
      totalChecked: 0,
      migrated: 0,
      skipped: 0,
      errors: 0,
      details: []
    };

    try {
      // TikTok APIからSmart+広告を取得
      const smartPlusAds = await tiktokService.getAllSmartPlusAds(
        token.advertiserId,
        token.accessToken
      );

      if (!smartPlusAds || smartPlusAds.length === 0) {
        console.log(`  Smart+広告: 0件 - スキップ`);
        results.push(result);
        continue;
      }

      console.log(`  Smart+広告: ${smartPlusAds.length}件を確認中...`);

      // 通常のad/get APIからad_idとsmart_plus_ad_idのマッピングを取得
      const adsResponse = await tiktokService.getAllAds(
        token.advertiserId,
        token.accessToken
      );

      // ad_id → smart_plus_ad_id のマッピングを作成
      const adIdToSmartPlusId = new Map<string, string>();
      for (const ad of adsResponse) {
        if (ad.smart_plus_ad_id) {
          adIdToSmartPlusId.set(String(ad.ad_id), String(ad.smart_plus_ad_id));
        }
      }

      console.log(`  ad_id→smart_plus_ad_idマッピング: ${adIdToSmartPlusId.size}件`);

      for (const spAd of smartPlusAds) {
        result.totalChecked++;
        const smartPlusAdId = String(spAd.smart_plus_ad_id);
        const correctAdName = spAd.ad_name;

        // smart_plus_ad_idでDBを検索（既に正しく登録されている場合）
        const existingBySmartPlusId = await prisma.ad.findUnique({
          where: { tiktokId: smartPlusAdId }
        });

        if (existingBySmartPlusId) {
          // 既に正しく登録されている - 広告名の確認のみ
          if (existingBySmartPlusId.name !== correctAdName) {
            // 広告名が異なる場合は更新
            const detail: MigrationDetail = {
              oldTiktokId: smartPlusAdId,
              newTiktokId: smartPlusAdId,
              oldName: existingBySmartPlusId.name,
              newName: correctAdName,
              status: 'migrated',
              reason: '広告名のみ更新'
            };

            if (!dryRun) {
              await prisma.ad.update({
                where: { tiktokId: smartPlusAdId },
                data: { name: correctAdName }
              });
            }

            result.migrated++;
            result.details.push(detail);
            console.log(`  ✓ 広告名更新: ${existingBySmartPlusId.name} → ${correctAdName}`);
          } else {
            result.skipped++;
          }
          continue;
        }

        // ad_idで登録されているレコードを探す
        // まずad_id→smart_plus_ad_idマッピングから逆引き
        let adIdForThisSmartPlus: string | null = null;
        for (const [adId, spId] of adIdToSmartPlusId.entries()) {
          if (spId === smartPlusAdId) {
            adIdForThisSmartPlus = adId;
            break;
          }
        }

        if (!adIdForThisSmartPlus) {
          // マッピングが見つからない場合、直接DBを検索
          // APIレスポンスにあるsmart_plus_ad_idに対応するad_idを探す
          result.errors++;
          result.details.push({
            oldTiktokId: 'N/A',
            newTiktokId: smartPlusAdId,
            oldName: 'N/A',
            newName: correctAdName,
            status: 'error',
            reason: 'ad_idマッピングが見つからない'
          });
          console.log(`  ✗ マッピングなし: ${correctAdName} (${smartPlusAdId})`);
          continue;
        }

        // ad_idでDBを検索
        const existingByAdId = await prisma.ad.findUnique({
          where: { tiktokId: adIdForThisSmartPlus },
          include: { metrics: true }
        });

        if (!existingByAdId) {
          // DBに存在しない（新規広告の可能性）
          result.errors++;
          result.details.push({
            oldTiktokId: adIdForThisSmartPlus,
            newTiktokId: smartPlusAdId,
            oldName: 'N/A',
            newName: correctAdName,
            status: 'error',
            reason: 'DBにレコードが存在しない'
          });
          console.log(`  ✗ DBになし: ${correctAdName} (ad_id: ${adIdForThisSmartPlus})`);
          continue;
        }

        // マイグレーション実行
        const detail: MigrationDetail = {
          oldTiktokId: adIdForThisSmartPlus,
          newTiktokId: smartPlusAdId,
          oldName: existingByAdId.name,
          newName: correctAdName,
          status: 'migrated'
        };

        if (!dryRun) {
          // tiktokIdと広告名を更新
          await prisma.ad.update({
            where: { id: existingByAdId.id },
            data: {
              tiktokId: smartPlusAdId,
              name: correctAdName
            }
          });
        }

        result.migrated++;
        result.details.push(detail);
        console.log(`  ✓ マイグレーション: ${adIdForThisSmartPlus} → ${smartPlusAdId}`);
        console.log(`    広告名: ${existingByAdId.name} → ${correctAdName}`);
        console.log(`    メトリクス: ${existingByAdId.metrics.length}件（維持）`);
      }

      totalMigrated += result.migrated;
      totalErrors += result.errors;

    } catch (error: any) {
      console.log(`  ✗ エラー: ${error.message}`);
      result.errors++;
    }

    results.push(result);
  }

  // サマリー
  console.log('\n\n========================================');
  console.log('【マイグレーション結果サマリー】');
  console.log('========================================\n');

  console.log('アカウント別:');
  console.log('─'.repeat(70));
  for (const result of results) {
    if (result.totalChecked > 0) {
      console.log(`${result.advertiserName}`);
      console.log(`  確認: ${result.totalChecked}件, 移行: ${result.migrated}件, スキップ: ${result.skipped}件, エラー: ${result.errors}件`);
    }
  }
  console.log('─'.repeat(70));

  console.log(`\n合計移行: ${totalMigrated}件`);
  console.log(`合計エラー: ${totalErrors}件`);

  if (dryRun) {
    console.log('\n⚠️ DRY RUNモードのため、実際の変更は行われていません。');
    console.log('本番実行するには、スクリプトの引数を false に変更してください。');
  } else {
    console.log('\n✓ マイグレーションが完了しました。');
  }

  // 詳細ログ
  const migratedDetails = results.flatMap(r => r.details.filter(d => d.status === 'migrated'));
  if (migratedDetails.length > 0) {
    console.log('\n\n========================================');
    console.log('【移行された広告の詳細】');
    console.log('========================================\n');

    migratedDetails.forEach((d, i) => {
      console.log(`[${i + 1}] ${d.newName}`);
      console.log(`    tiktokId: ${d.oldTiktokId} → ${d.newTiktokId}`);
      if (d.reason) console.log(`    備考: ${d.reason}`);
      console.log('');
    });
  }

  await app.close();
}

// DRY RUN モードで実行（実際の変更なし）
// 本番実行する場合は false に変更
const DRY_RUN = false;

migrateSmartPlusAdIds(DRY_RUN);
