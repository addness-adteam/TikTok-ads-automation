/**
 * キャンペーンタイプと広告名フィールドを分析するスクリプト
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  console.log('========================================');
  console.log('キャンペーンタイプと広告名フィールド分析');
  console.log('========================================\n');

  try {
    // AI1アカウントを探す
    const advertiser = await prisma.advertiser.findFirst({
      where: {
        OR: [
          { name: { contains: 'AI_1' } },
          { name: { contains: 'ai_1' } },
        ]
      }
    });

    if (!advertiser) {
      console.log('❌ AI_1という名前のAdvertiserが見つかりませんでした');
      await app.close();
      return;
    }

    console.log(`✓ AI1アカウント: ${advertiser.name}`);
    console.log(`  Advertiser ID: ${advertiser.tiktokAdvertiserId}\n`);

    // アクセストークンを取得
    const token = await prisma.oAuthToken.findFirst({
      where: {
        advertiserId: advertiser.tiktokAdvertiserId,
        expiresAt: { gt: new Date() }
      }
    });

    if (!token) {
      console.log('❌ 有効なアクセストークンが見つかりません');
      await app.close();
      return;
    }

    // キャンペーンを取得
    console.log('========================================');
    console.log('キャンペーン分析');
    console.log('========================================\n');

    const campaignsResponse = await tiktokService.getCampaigns(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );

    const campaigns = campaignsResponse.data?.list || [];
    console.log(`全キャンペーン数: ${campaigns.length}\n`);

    // campaign_automation_typeごとに集計
    const automationTypes = new Map<string, any[]>();
    campaigns.forEach((campaign: any) => {
      const type = campaign.campaign_automation_type || 'NO_AUTOMATION';
      if (!automationTypes.has(type)) {
        automationTypes.set(type, []);
      }
      automationTypes.get(type)!.push(campaign);
    });

    console.log('campaign_automation_type の種類:\n');
    automationTypes.forEach((campaigns, type) => {
      console.log(`  ${type}: ${campaigns.length}件`);
    });

    console.log('\n========================================');
    console.log('各タイプの詳細');
    console.log('========================================\n');

    for (const [type, typeCampaigns] of automationTypes.entries()) {
      console.log(`\n■ ${type} (${typeCampaigns.length}件)\n`);

      // 最初のキャンペーンの詳細を表示
      const sample = typeCampaigns[0];
      console.log('  サンプルキャンペーン:');
      console.log(`    Campaign ID: ${sample.campaign_id}`);
      console.log(`    Campaign Name: ${sample.campaign_name}`);
      console.log(`    Status: ${sample.operation_status}`);
      console.log(`    Objective: ${sample.objective_type}`);
      console.log(`    Budget Mode: ${sample.budget_mode}`);

      // 利用可能なフィールドを表示
      console.log('\n  利用可能なフィールド:');
      Object.keys(sample).sort().forEach(key => {
        const value = sample[key];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          console.log(`    ${key}: ${value}`);
        } else if (value !== null && value !== undefined) {
          console.log(`    ${key}: [${typeof value}]`);
        }
      });

      // このキャンペーンの広告を取得
      console.log('\n  広告の分析:');
      const adsResponse = await tiktokService.getAds(
        advertiser.tiktokAdvertiserId,
        token.accessToken
      );
      const allAds = adsResponse.data?.list || [];
      const campaignAds = allAds.filter((ad: any) =>
        ad.campaign_id === sample.campaign_id && ad.operation_status === 'ENABLE'
      );

      console.log(`    配信中の広告数: ${campaignAds.length}`);

      if (campaignAds.length > 0) {
        const sampleAd = campaignAds[0];
        console.log('\n    サンプル広告:');
        console.log(`      Ad ID: ${sampleAd.ad_id}`);
        console.log(`      Ad Name: ${sampleAd.ad_name}`);

        // 広告名関連のフィールドを全て確認
        const nameRelatedFields = [
          'ad_name',
          'ad_display_name',
          'display_name',
          'creative_name',
          'ad_text',
          'title',
          'card_title',
          'identity_name',
          'page_name'
        ];

        console.log('\n    広告名関連フィールド:');
        nameRelatedFields.forEach(field => {
          if (sampleAd[field] !== undefined && sampleAd[field] !== null && sampleAd[field] !== '') {
            console.log(`      ${field}: ${sampleAd[field]}`);
          }
        });

        // Smart Plus関連フィールド
        if (sampleAd.smart_plus_ad_id) {
          console.log('\n    Smart Plus 関連:');
          console.log(`      smart_plus_ad_id: ${sampleAd.smart_plus_ad_id}`);
        }

        // CR名判定
        const extensions = ['.mp4', '.MP4', '.mov', '.MOV', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG'];
        const isCreativeName = extensions.some(ext => sampleAd.ad_name && sampleAd.ad_name.includes(ext));
        const parts = sampleAd.ad_name ? sampleAd.ad_name.split('/') : [];
        const isParseable = parts.length >= 4;

        console.log('\n    広告名判定:');
        console.log(`      CR名: ${isCreativeName ? 'Yes' : 'No'}`);
        console.log(`      パース可能: ${isParseable ? 'Yes' : 'No'}`);
      }
    }

    // 全広告の統計
    console.log('\n========================================');
    console.log('全広告の広告名パターン統計');
    console.log('========================================\n');

    const adsResponse = await tiktokService.getAds(
      advertiser.tiktokAdvertiserId,
      token.accessToken
    );
    const allAds = adsResponse.data?.list || [];
    const activeAds = allAds.filter((ad: any) => ad.operation_status === 'ENABLE');

    const extensions = ['.mp4', '.MP4', '.mov', '.MOV', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG'];

    let creativeNameCount = 0;
    let parseableNameCount = 0;
    let otherNameCount = 0;

    activeAds.forEach((ad: any) => {
      const isCreativeName = extensions.some(ext => ad.ad_name && ad.ad_name.includes(ext));
      const parts = ad.ad_name ? ad.ad_name.split('/') : [];
      const isParseable = parts.length >= 4 && !isCreativeName;

      if (isCreativeName) {
        creativeNameCount++;
      } else if (isParseable) {
        parseableNameCount++;
      } else {
        otherNameCount++;
      }
    });

    console.log(`配信中の広告総数: ${activeAds.length}`);
    console.log(`  CR名（拡張子付き）: ${creativeNameCount}件 (${((creativeNameCount/activeAds.length)*100).toFixed(1)}%)`);
    console.log(`  パース可能な形式: ${parseableNameCount}件 (${((parseableNameCount/activeAds.length)*100).toFixed(1)}%)`);
    console.log(`  その他: ${otherNameCount}件 (${((otherNameCount/activeAds.length)*100).toFixed(1)}%)`);

    if (parseableNameCount > 0) {
      console.log('\n✅ パース可能な広告名のサンプル（最大5件）:');
      let count = 0;
      for (const ad of activeAds) {
        const isCreativeName = extensions.some(ext => ad.ad_name && ad.ad_name.includes(ext));
        const parts = ad.ad_name ? ad.ad_name.split('/') : [];
        const isParseable = parts.length >= 4 && !isCreativeName;

        if (isParseable && count < 5) {
          console.log(`  [${count + 1}] ${ad.ad_name}`);
          console.log(`      Campaign: ${ad.campaign_name}`);
          console.log(`      campaign_automation_type: ${ad.campaign_automation_type || 'N/A'}`);
          count++;
        }
      }
    }

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
