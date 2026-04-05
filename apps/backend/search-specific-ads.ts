/**
 * TikTok APIから直接、特定の広告名を含む広告を検索するスクリプト
 *
 * 検索対象:
 * - CR00679
 * - CR00680
 * - 251204/高橋海斗
 *
 * アカウント:
 * - SNS_1: TikTok Advertiser ID = 7247073333517238273
 * - AI_1: TikTok Advertiser ID = 7468288053866561553
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

  // 検索キーワード
  const searchKeywords = ['CR00679', 'CR00680', '251204/高橋海斗'];

  console.log('='.repeat(80));
  console.log('TikTok API 広告検索');
  console.log('='.repeat(80));
  console.log(`検索キーワード: ${searchKeywords.join(', ')}`);
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
        console.log(`  ❌ アクセストークンが見つかりません: ${account.advertiserId}`);
        continue;
      }

      console.log(`  ✅ アクセストークン取得成功`);

      // 全広告を取得（ページネーション対応）
      console.log(`  📡 TikTok APIから全広告を取得中...`);
      const allAds = await tiktokService.getAllAds(
        account.advertiserId,
        tokenRecord.accessToken,
      );

      console.log(`  📊 取得した広告総数: ${allAds.length}`);

      // キーワードマッチング
      const matchedAds: any[] = [];
      for (const keyword of searchKeywords) {
        const matches = allAds.filter((ad: any) =>
          ad.ad_name && ad.ad_name.includes(keyword)
        );

        if (matches.length > 0) {
          console.log(`\n  🔍 キーワード「${keyword}」にマッチした広告: ${matches.length}件`);

          for (const ad of matches) {
            matchedAds.push({
              keyword,
              ad,
            });

            console.log(`    ┌${'─'.repeat(70)}`);
            console.log(`    │ 広告名: ${ad.ad_name}`);
            console.log(`    │ TikTok広告ID: ${ad.ad_id}`);
            console.log(`    │ ステータス: ${ad.operation_status} (二次審査: ${ad.secondary_status || 'N/A'})`);
            console.log(`    │ 広告グループID: ${ad.adgroup_id}`);
            console.log(`    │ キャンペーンID: ${ad.campaign_id}`);
            console.log(`    │ 作成日時: ${ad.create_time}`);
            console.log(`    │ 更新日時: ${ad.modify_time}`);
            console.log(`    └${'─'.repeat(70)}`);
          }
        } else {
          console.log(`\n  ℹ️  キーワード「${keyword}」にマッチする広告はありませんでした`);
        }
      }

      // メトリクスデータを取得（マッチした広告がある場合のみ）
      if (matchedAds.length > 0) {
        console.log(`\n  📊 マッチした広告のメトリクス情報を取得中...`);

        // 昨日の日付を取得（YYYY-MM-DD形式）
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const startDate = yesterday.toISOString().split('T')[0];
        const endDate = startDate;

        console.log(`  📅 対象期間: ${startDate} ~ ${endDate}`);

        try {
          // 広告IDのリストを作成
          const adIds = matchedAds.map(m => m.ad.ad_id);

          // メトリクスを取得
          const metricsData = await tiktokService.getReport(
            account.advertiserId,
            tokenRecord.accessToken,
            {
              dataLevel: 'AUCTION_AD',
              startDate,
              endDate,
              filtering: {
                ad_ids: adIds,
              },
              metrics: [
                'impressions',
                'clicks',
                'spend',
                'conversions',
                'ctr',
                'cpc',
                'cpm',
                'cost_per_conversion',
              ],
            },
          );

          if (metricsData?.data?.list && metricsData.data.list.length > 0) {
            console.log(`\n  📈 メトリクス情報 (${startDate}):`);

            for (const metric of metricsData.data.list) {
              const adId = metric.dimensions?.ad_id || metric.ad_id;
              const matchedAd = matchedAds.find(m => m.ad.ad_id === adId);

              if (matchedAd) {
                console.log(`    ┌${'─'.repeat(70)}`);
                console.log(`    │ 広告名: ${matchedAd.ad.ad_name}`);
                console.log(`    │ TikTok広告ID: ${adId}`);
                console.log(`    │ ──────────────────────────────────────────────`);
                console.log(`    │ インプレッション数: ${metric.metrics.impressions || 0}`);
                console.log(`    │ クリック数: ${metric.metrics.clicks || 0}`);
                console.log(`    │ 支出 (Spend): ${metric.metrics.spend || 0} (通貨単位)`);
                console.log(`    │ コンバージョン数: ${metric.metrics.conversions || 0}`);
                console.log(`    │ CTR: ${metric.metrics.ctr || 0}%`);
                console.log(`    │ CPC: ${metric.metrics.cpc || 0}`);
                console.log(`    │ CPM: ${metric.metrics.cpm || 0}`);
                console.log(`    │ CPA: ${metric.metrics.cost_per_conversion || 0}`);
                console.log(`    └${'─'.repeat(70)}`);
              }
            }
          } else {
            console.log(`  ℹ️  メトリクスデータが見つかりませんでした（期間: ${startDate}）`);
          }
        } catch (metricsError: any) {
          console.log(`  ⚠️  メトリクス取得中にエラー: ${metricsError.message}`);
        }
      }

    } catch (error: any) {
      console.error(`  ❌ エラーが発生しました: ${error.message}`);
      if (error.response?.data) {
        console.error(`  詳細: ${JSON.stringify(error.response.data, null, 2)}`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('検索完了');
  console.log('='.repeat(80));

  await app.close();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
