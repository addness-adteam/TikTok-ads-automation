/**
 * Smart+広告の手動同期スクリプト
 * 同期が失敗している原因も調査
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { TiktokService } from './src/tiktok/tiktok.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tiktokService = app.get(TiktokService);

  console.log('========================================');
  console.log('Smart+広告の手動同期');
  console.log('========================================\n');

  try {
    // 全Advertiserに対して実行
    const oauthTokens = await prisma.oAuthToken.findMany({
      where: {
        expiresAt: { gt: new Date() }
      }
    });

    console.log(`有効なトークン: ${oauthTokens.length}件\n`);

    let totalSynced = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const token of oauthTokens) {
      console.log(`\n========================================`);
      console.log(`Advertiser: ${token.advertiserId}`);
      console.log(`========================================`);

      // Advertiser情報を取得
      const advertiser = await prisma.advertiser.findUnique({
        where: { tiktokAdvertiserId: token.advertiserId }
      });

      if (!advertiser) {
        console.log(`⚠️ Advertiserが見つかりません、スキップ`);
        continue;
      }

      console.log(`Name: ${advertiser.name}`);

      // Smart+ Adsを取得
      const smartPlusAdsResult = await tiktokService.getSmartPlusAds(
        token.advertiserId,
        token.accessToken
      );

      const smartPlusAds = smartPlusAdsResult.data?.list || [];
      console.log(`\nSmart+ API: ${smartPlusAds.length}件取得`);

      let synced = 0;
      let skipped = 0;
      let errors = 0;

      for (const ad of smartPlusAds) {
        const adId = ad.smart_plus_ad_id || ad.ad_id;
        if (!adId) {
          console.log(`  ⚠️ 広告IDなし、スキップ`);
          skipped++;
          continue;
        }

        // 既にDBに存在するか確認
        const existingAd = await prisma.ad.findUnique({
          where: { tiktokId: String(adId) }
        });

        if (existingAd) {
          // 既に存在する場合は更新のみ
          await prisma.ad.update({
            where: { id: existingAd.id },
            data: {
              name: ad.ad_name,
              status: ad.operation_status,
            }
          });
          continue; // カウントしない（既存）
        }

        // AdGroupを探す
        if (!ad.adgroup_id) {
          console.log(`  ⚠️ ${ad.ad_name}: adgroup_idなし、スキップ`);
          skipped++;
          continue;
        }

        const adgroup = await prisma.adGroup.findUnique({
          where: { tiktokId: String(ad.adgroup_id) }
        });

        if (!adgroup) {
          console.log(`  ⚠️ ${ad.ad_name}: AdGroup ${ad.adgroup_id} がDBにありません`);

          // AdGroupも同期を試みる
          const campaign = await prisma.campaign.findUnique({
            where: { tiktokId: String(ad.campaign_id) }
          });

          if (!campaign) {
            console.log(`    → Campaign ${ad.campaign_id} もDBにありません、スキップ`);
            skipped++;
            continue;
          }

          // AdGroupをAPIから取得して同期
          try {
            const adgroupsResult = await tiktokService.getAdGroups(
              token.advertiserId,
              token.accessToken,
              [ad.campaign_id]
            );

            const targetAdgroup = adgroupsResult.data?.list?.find(
              (ag: any) => String(ag.adgroup_id) === String(ad.adgroup_id)
            );

            if (targetAdgroup) {
              await prisma.adGroup.create({
                data: {
                  tiktokId: String(targetAdgroup.adgroup_id),
                  campaignId: campaign.id,
                  name: targetAdgroup.adgroup_name,
                  placementType: targetAdgroup.placement_type,
                  budgetMode: targetAdgroup.budget_mode,
                  budget: targetAdgroup.budget,
                  bidType: targetAdgroup.bid_type,
                  bidPrice: targetAdgroup.bid_price,
                  targeting: targetAdgroup as any,
                  schedule: {
                    startTime: targetAdgroup.schedule_start_time,
                    endTime: targetAdgroup.schedule_end_time,
                  },
                  status: targetAdgroup.operation_status,
                }
              });
              console.log(`    → AdGroup ${ad.adgroup_id} を新規作成しました`);
            } else {
              console.log(`    → AdGroup ${ad.adgroup_id} がAPIにも見つかりません、スキップ`);
              skipped++;
              continue;
            }
          } catch (error: any) {
            console.log(`    → AdGroup同期エラー: ${error.message}`);
            errors++;
            continue;
          }
        }

        // 再度AdGroupを取得
        const finalAdgroup = await prisma.adGroup.findUnique({
          where: { tiktokId: String(ad.adgroup_id) }
        });

        if (!finalAdgroup) {
          console.log(`  ⚠️ ${ad.ad_name}: AdGroup同期後も見つかりません、スキップ`);
          skipped++;
          continue;
        }

        // Creativeを処理（存在しない場合はダミー作成）
        let creativeId: string | null = null;

        const creativeList = ad.creative_list || [];
        const enabledCreative = creativeList.find(
          (c: any) => c.material_operation_status === 'ENABLE'
        ) || creativeList[0]; // ENABLEがなければ最初のものを使用

        if (enabledCreative?.creative_info) {
          const creativeInfo = enabledCreative.creative_info;
          const videoId = creativeInfo.video_info?.video_id;
          const imageInfo = creativeInfo.image_info;

          if (videoId) {
            let creative = await prisma.creative.findFirst({
              where: { tiktokVideoId: videoId }
            });

            if (!creative) {
              creative = await prisma.creative.create({
                data: {
                  advertiserId: advertiser.id,
                  name: creativeInfo.material_name || `Video ${videoId}`,
                  type: 'VIDEO',
                  tiktokVideoId: videoId,
                  url: videoId || '',
                  filename: `video_${videoId}`,
                }
              });
            }
            creativeId = creative.id;
          } else if (imageInfo && imageInfo.length > 0) {
            const imageId = imageInfo[0].web_uri || imageInfo[0].image_id;

            if (imageId) {
              let creative = await prisma.creative.findFirst({
                where: { tiktokImageId: imageId }
              });

              if (!creative) {
                creative = await prisma.creative.create({
                  data: {
                    advertiserId: advertiser.id,
                    name: creativeInfo.material_name || `Image ${imageId}`,
                    type: 'IMAGE',
                    tiktokImageId: imageId,
                    url: imageId || '',
                    filename: `image_${imageId}`,
                  }
                });
              }
              creativeId = creative.id;
            }
          }
        }

        // クリエイティブがない場合はダミーを作成
        if (!creativeId) {
          console.log(`  ⚠️ ${ad.ad_name}: クリエイティブなし、ダミーを作成`);

          const dummyCreative = await prisma.creative.create({
            data: {
              advertiserId: advertiser.id,
              name: `Smart+ Ad ${adId}`,
              type: 'VIDEO',
              tiktokVideoId: `smartplus_${adId}`,
              url: '',
              filename: `smartplus_${adId}`,
            }
          });
          creativeId = dummyCreative.id;
        }

        // Adを作成
        try {
          await prisma.ad.create({
            data: {
              tiktokId: String(adId),
              adgroupId: finalAdgroup.id,
              name: ad.ad_name || `Smart+ Ad ${adId}`,
              creativeId,
              adText: ad.ad_text_list?.[0]?.ad_text,
              callToAction: ad.ad_configuration?.call_to_action_id,
              landingPageUrl: ad.landing_page_url_list?.[0]?.landing_page_url,
              displayName: enabledCreative?.creative_info?.identity_id,
              status: ad.operation_status,
              reviewStatus: 'APPROVED',
            }
          });

          console.log(`  ✓ ${ad.ad_name} を同期しました`);
          synced++;
        } catch (error: any) {
          console.log(`  ✗ ${ad.ad_name}: 作成エラー - ${error.message}`);
          errors++;
        }
      }

      console.log(`\n結果: 同期=${synced}, スキップ=${skipped}, エラー=${errors}`);
      totalSynced += synced;
      totalSkipped += skipped;
      totalErrors += errors;
    }

    console.log('\n========================================');
    console.log('全体結果');
    console.log('========================================');
    console.log(`同期完了: ${totalSynced}件`);
    console.log(`スキップ: ${totalSkipped}件`);
    console.log(`エラー: ${totalErrors}件`);

    // 同期後の確認
    console.log('\n========================================');
    console.log('同期後の確認（AI_1）');
    console.log('========================================');

    const ai1 = await prisma.advertiser.findFirst({
      where: { name: { contains: 'AI_1' } }
    });

    if (ai1) {
      const ai1Token = await prisma.oAuthToken.findFirst({
        where: { advertiserId: ai1.tiktokAdvertiserId }
      });

      if (ai1Token) {
        const smartPlusResponse = await tiktokService.getSmartPlusAds(
          ai1.tiktokAdvertiserId,
          ai1Token.accessToken
        );

        const apiAds = smartPlusResponse.data?.list || [];
        const dbAds = await prisma.ad.findMany({
          where: {
            adGroup: {
              campaign: {
                advertiserId: ai1.id
              }
            }
          }
        });

        const apiAdIds = new Set(apiAds.map((ad: any) => ad.smart_plus_ad_id));
        const dbAdIds = new Set(dbAds.map(ad => ad.tiktokId));

        const onlyInApi = [...apiAdIds].filter(id => !dbAdIds.has(id as string));

        console.log(`Smart+ API: ${apiAds.length}件`);
        console.log(`DB Ads: ${dbAds.length}件`);
        console.log(`APIにのみ存在（未同期）: ${onlyInApi.length}件`);

        if (onlyInApi.length > 0) {
          console.log(`\n未同期の広告ID: ${onlyInApi.slice(0, 5).join(', ')}${onlyInApi.length > 5 ? '...' : ''}`);
        }
      }
    }

  } catch (error: any) {
    console.error('❌ エラー:', error.message);
    console.error(error.stack);
  } finally {
    await app.close();
  }
}

main();
