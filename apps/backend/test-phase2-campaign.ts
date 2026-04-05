/**
 * Phase 2: 旧スマートプラスキャンペーンの検出と評価テスト
 *
 * 特定のキャンペーン（251024/セン/SNSまとめ(勝)/LP2-CR00033）を
 * 検出して評価するテスト
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { TiktokService } from './src/tiktok/tiktok.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const tiktokService = app.get(TiktokService);

  const advertiserId = '7543540381615800337';
  const targetCampaignName = '251024/セン/SNSまとめ(勝)/LP2-CR00033';
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN || '';

  if (!accessToken) {
    console.error('❌ TIKTOK_ACCESS_TOKEN not found');
    process.exit(1);
  }

  console.log('========================================');
  console.log('Phase 2: 旧スマートプラスキャンペーン検出テスト');
  console.log('========================================');
  console.log(`Advertiser ID: ${advertiserId}`);
  console.log(`Target Campaign: ${targetCampaignName}\n`);

  try {
    // 1. 配信中のキャンペーンを取得
    console.log('Step 1: 配信中のキャンペーンを取得...');
    const campaignsResponse = await tiktokService.getCampaigns(
      advertiserId,
      accessToken
    );

    const allCampaigns = campaignsResponse.data?.list || [];
    console.log(`✓ 全キャンペーン数: ${allCampaigns.length}\n`);

    // 2. 配信中のキャンペーンのみフィルタ
    const activeCampaigns = allCampaigns.filter(
      (campaign: any) => campaign.operation_status === 'ENABLE'
    );
    console.log(`✓ 配信中のキャンペーン数: ${activeCampaigns.length}\n`);

    // 3. ターゲットキャンペーンを検索
    console.log('Step 2: ターゲットキャンペーンを検索...');
    const targetCampaign = activeCampaigns.find(
      (campaign: any) => campaign.campaign_name === targetCampaignName
    );

    if (!targetCampaign) {
      console.log(`❌ ターゲットキャンペーン "${targetCampaignName}" が見つかりませんでした\n`);
      console.log('配信中のキャンペーン名一覧:');
      activeCampaigns.slice(0, 10).forEach((campaign: any, index: number) => {
        console.log(`  [${index + 1}] ${campaign.campaign_name} (ID: ${campaign.campaign_id})`);
      });
      if (activeCampaigns.length > 10) {
        console.log(`  ... and ${activeCampaigns.length - 10} more`);
      }
      await app.close();
      return;
    }

    console.log(`✅ ターゲットキャンペーンが見つかりました！`);
    console.log(`   Campaign ID: ${targetCampaign.campaign_id}`);
    console.log(`   Campaign Name: ${targetCampaign.campaign_name}`);
    console.log(`   Status: ${targetCampaign.operation_status}`);
    console.log(`   Budget: ${targetCampaign.budget}`);
    console.log(`   Budget Mode: ${targetCampaign.budget_mode}\n`);

    // 4. キャンペーン配下の広告を取得
    console.log('Step 3: キャンペーン配下の広告を確認...');
    const adsResponse = await tiktokService.getAds(advertiserId, accessToken);
    const allAds = adsResponse.data?.list || [];
    const campaignAds = allAds.filter(
      (ad: any) => ad.campaign_id === targetCampaign.campaign_id
    );

    console.log(`✓ キャンペーン配下の広告数: ${campaignAds.length}`);

    // CR名判定ヘルパー関数
    const isCreativeName = (adName: string) => {
      if (!adName) return false;
      const extensions = ['.mp4', '.MP4', '.mov', '.MOV', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.gif', '.GIF'];
      return extensions.some(ext => adName.includes(ext));
    };

    if (campaignAds.length > 0) {
      console.log('\n広告リスト:');
      campaignAds.forEach((ad: any, index: number) => {
        const hasName = ad.ad_name && ad.ad_name.trim() !== '';
        const isCR = isCreativeName(ad.ad_name);
        console.log(`  [${index + 1}] Ad ID: ${ad.ad_id}`);
        console.log(`      Ad Name: ${hasName ? ad.ad_name : '（広告名なし）'}`);
        console.log(`      Is Creative Name (CR名): ${isCR ? 'Yes' : 'No'}`);
        console.log(`      Status: ${ad.operation_status}`);
      });

      // 広告名の種類を確認
      const allAdsHaveCreativeNames = campaignAds.every(
        (ad: any) => isCreativeName(ad.ad_name)
      );
      const hasManualAdNames = campaignAds.some(
        (ad: any) => ad.ad_name && ad.ad_name.trim() !== '' && !isCreativeName(ad.ad_name)
      );

      console.log(`\n✓ 全広告がCR名（拡張子含む）: ${allAdsHaveCreativeNames ? 'Yes' : 'No'}`);
      console.log(`✓ 手動広告名を持つ広告: ${hasManualAdNames ? 'あり' : 'なし'}\n`);

      if (allAdsHaveCreativeNames && !hasManualAdNames) {
        console.log('========================================');
        console.log('Phase 2 判定: ✅ 旧スマートプラスキャンペーン');
        console.log('========================================');
        console.log('このキャンペーンはPhase 2で以下のように処理されます：');
        console.log('1. キャンペーン名をパース → LP名を抽出');
        console.log('2. キャンペーンレベルのメトリクスを集計');
        console.log('3. Google SheetsからCV数・フロント販売本数を取得');
        console.log('4. CPA・フロントCPOを計算して判定');
        console.log('5. 予算調整または停止を実行\n');
      } else {
        console.log('========================================');
        console.log('Phase 1 判定: ⚠️  通常キャンペーンまたは新スマートプラス');
        console.log('========================================');
        console.log('このキャンペーンはPhase 1で広告レベルで処理されます');
        console.log('（広告名が手動で付けられているため、既存ロジックで処理可能）\n');
      }
    }

    // 5. キャンペーン名のパーステスト
    console.log('Step 4: キャンペーン名のパーステスト...');
    const nameParts = targetCampaign.campaign_name.split('/');
    if (nameParts.length >= 4) {
      console.log(`✓ キャンペーン名のフォーマット: 正常`);
      console.log(`   出稿日: ${nameParts[0]}`);
      console.log(`   制作者: ${nameParts[1]}`);
      console.log(`   CR名: ${nameParts.slice(2, nameParts.length - 1).join('/')}`);
      console.log(`   LP名: ${nameParts[nameParts.length - 1]}`);
      console.log(`\n✓ 登録経路: TikTok広告-SNS-${nameParts[nameParts.length - 1]}\n`);
    } else {
      console.log(`❌ キャンペーン名のフォーマットが不正です\n`);
    }

    console.log('========================================');
    console.log('テスト完了');
    console.log('========================================');

  } catch (error: any) {
    console.error('\n❌ エラーが発生しました:');
    console.error(error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
  } finally {
    await app.close();
  }
}

bootstrap();
