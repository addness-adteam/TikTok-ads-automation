import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TiktokService } from '../tiktok/tiktok.service';
import { AdPerformanceService } from '../ad-performance/ad-performance.service';
import {
  BatchExecutionTracker,
  logBatchExecutionResult,
  batchJobLock,
  BatchErrorType,
  withDatabaseRetry,
} from '../common/utils';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  // 注意: ロック機構は batchJobLock に統一（二重管理の問題を解消）
  // isSyncRunning, isReportRunning フラグは削除済み

  constructor(
    private readonly prisma: PrismaService,
    private readonly tiktokService: TiktokService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => AdPerformanceService))
    private readonly adPerformanceService: AdPerformanceService,
  ) {}

  async onModuleInit() {
    this.logger.log('Scheduler Service initialized');
  }

  /**
   * 日次広告同期バッチジョブ
   * 毎日0時0分（日本時間）に実行
   * メトリクス取得の前に広告データをDBに同期
   */
  @Cron('0 0 * * *', {
    name: 'daily-entity-sync',
    timeZone: 'Asia/Tokyo',
  })
  async scheduleDailyEntitySync() {
    const jobName = 'daily-entity-sync';

    // S-01: 同時実行競合チェック（ロック機能統一 - batchJobLockのみ使用）
    // タイムアウトを30分に延長（大量データ処理対応）
    if (!batchJobLock.acquire(jobName, 1800000)) { // 30分タイムアウト
      const lockStartTime = batchJobLock.getLockStartTime(jobName);
      this.logger.warn(
        `[S-01] Previous entity sync job is still running (started: ${lockStartTime?.toISOString()}). Skipping...`
      );
      return;
    }

    this.logger.log('Starting daily entity sync batch job');

    try {
      // データベースから全ての有効なOAuthTokenを取得
      const oauthTokens = await this.prisma.oAuthToken.findMany({
        where: {
          expiresAt: {
            gt: new Date(),
          },
        },
      });

      if (oauthTokens.length === 0) {
        this.logger.warn('No active tokens found. Skipping entity sync.');
        return;
      }

      let totalCampaigns = 0;
      let totalAdgroups = 0;
      let totalAds = 0;
      let errorCount = 0;

      // 各Advertiserに対して広告同期を実行
      for (const token of oauthTokens) {
        try {
          this.logger.log(`Syncing entities for advertiser: ${token.advertiserId}`);

          // Advertiserレコードを確実に存在させる
          const advertiser = await this.prisma.advertiser.upsert({
            where: { tiktokAdvertiserId: token.advertiserId },
            create: {
              tiktokAdvertiserId: token.advertiserId,
              name: `Advertiser ${token.advertiserId}`,
            },
            update: {},
          });

          // Campaignを取得してDBに保存（ページネーション対応）
          const campaigns = await this.tiktokService.getAllCampaigns(
            token.advertiserId,
            token.accessToken,
          );
          let campaignsSynced = 0;

          for (const campaign of campaigns) {
            await this.prisma.campaign.upsert({
              where: { tiktokId: String(campaign.campaign_id) },
              create: {
                tiktokId: String(campaign.campaign_id),
                advertiserId: advertiser.id,
                name: campaign.campaign_name,
                objectiveType: campaign.objective_type,
                budgetMode: campaign.budget_mode,
                budget: campaign.budget || null,
                budgetOptimizeOn: campaign.budget_optimize_on === true || campaign.budget_optimize_on === 'ON',
                initialBudget: campaign.budget || null,
                status: campaign.operation_status,
              },
              update: {
                name: campaign.campaign_name,
                objectiveType: campaign.objective_type,
                budgetMode: campaign.budget_mode,
                budget: campaign.budget || null,
                budgetOptimizeOn: campaign.budget_optimize_on === true || campaign.budget_optimize_on === 'ON',
                status: campaign.operation_status,
              },
            });
            campaignsSynced++;
          }

          // AdGroupを取得してDBに保存（ページネーション対応）
          const adgroups = await this.tiktokService.getAllAdGroups(
            token.advertiserId,
            token.accessToken,
          );
          let adgroupsSynced = 0;

          for (const adgroup of adgroups) {
            const campaign = await this.prisma.campaign.findUnique({
              where: { tiktokId: String(adgroup.campaign_id) },
            });

            if (!campaign) {
              this.logger.warn(`Campaign ${adgroup.campaign_id} not found, skipping adgroup ${adgroup.adgroup_id}`);
              continue;
            }

            await this.prisma.adGroup.upsert({
              where: { tiktokId: String(adgroup.adgroup_id) },
              create: {
                tiktokId: String(adgroup.adgroup_id),
                campaignId: campaign.id,
                name: adgroup.adgroup_name,
                placementType: adgroup.placement_type,
                budgetMode: adgroup.budget_mode,
                budget: adgroup.budget,
                initialBudget: adgroup.budget, // 入稿時の初期予算を記録（0時リセット時にこの値に戻す）
                bidType: adgroup.bid_type,
                bidPrice: adgroup.bid_price,
                targeting: adgroup as any,
                schedule: {
                  startTime: adgroup.schedule_start_time,
                  endTime: adgroup.schedule_end_time,
                },
                status: adgroup.operation_status,
              },
              update: {
                name: adgroup.adgroup_name,
                placementType: adgroup.placement_type,
                budgetMode: adgroup.budget_mode,
                budget: adgroup.budget,
                bidType: adgroup.bid_type,
                bidPrice: adgroup.bid_price,
                targeting: adgroup as any,
                schedule: {
                  startTime: adgroup.schedule_start_time,
                  endTime: adgroup.schedule_end_time,
                },
                status: adgroup.operation_status,
              },
            });
            adgroupsSynced++;
          }

          // Adを取得してDBに保存（ページネーション対応）
          const ads = await this.tiktokService.getAllAds(
            token.advertiserId,
            token.accessToken,
          );
          let adsSynced = 0;

          // Smart+ 広告の手動設定名を取得するためのマップを作成
          // ad/get APIが返すsmart_plus_ad_idをキーに、正しい広告名を取得
          const smartPlusAdNameMap = new Map<string, string>();
          const smartPlusAdStatusMap = new Map<string, string>();
          try {
            const smartPlusAdsForNames = await this.tiktokService.getAllSmartPlusAds(
              token.advertiserId,
              token.accessToken,
            );
            for (const spAd of smartPlusAdsForNames) {
              if (spAd.smart_plus_ad_id && spAd.ad_name) {
                smartPlusAdNameMap.set(String(spAd.smart_plus_ad_id), spAd.ad_name);
              }
              if (spAd.smart_plus_ad_id && spAd.operation_status) {
                smartPlusAdStatusMap.set(String(spAd.smart_plus_ad_id), spAd.operation_status);
              }
            }
            this.logger.log(`Built Smart+ ad name map with ${smartPlusAdNameMap.size} entries, status map with ${smartPlusAdStatusMap.size} entries`);
          } catch (error) {
            this.logger.warn(`Failed to fetch Smart+ ads for name mapping: ${error.message}`);
          }

          // === N+1クエリ削減: ループ前に参照データを一括取得してMap化 ===
          const adGroupTiktokIds = [...new Set(ads.map((a: any) => String(a.adgroup_id)).filter(Boolean))];
          const videoIds = [...new Set(ads.map((a: any) => a.video_id).filter(Boolean))] as string[];
          const imageIds = [...new Set(ads.flatMap((a: any) => a.image_ids ?? []).filter(Boolean))] as string[];
          const candidateAdTiktokIds = [...new Set(ads.map((a: any) => String(a.smart_plus_ad_id ?? a.ad_id)).filter(Boolean))];
          const [adGroupList, videoCreativeList, imageCreativeList, existingAdList] = await Promise.all([
            adGroupTiktokIds.length ? this.prisma.adGroup.findMany({
              where: { tiktokId: { in: adGroupTiktokIds } },
              select: { id: true, tiktokId: true },
            }) : Promise.resolve([]),
            videoIds.length ? this.prisma.creative.findMany({
              where: { tiktokVideoId: { in: videoIds } },
              select: { id: true, tiktokVideoId: true },
            }) : Promise.resolve([]),
            imageIds.length ? this.prisma.creative.findMany({
              where: { tiktokImageId: { in: imageIds } },
              select: { id: true, tiktokImageId: true },
            }) : Promise.resolve([]),
            candidateAdTiktokIds.length ? this.prisma.ad.findMany({
              where: { tiktokId: { in: candidateAdTiktokIds } },
              select: { tiktokId: true, status: true },
            }) : Promise.resolve([]),
          ]);
          const adGroupMap = new Map<string, { id: string; tiktokId: string }>(
            (adGroupList as any[]).map((g) => [g.tiktokId, g])
          );
          const videoCreativeMap = new Map<string, { id: string }>(
            (videoCreativeList as any[]).filter((c) => c.tiktokVideoId).map((c) => [c.tiktokVideoId, { id: c.id }])
          );
          const imageCreativeMap = new Map<string, { id: string }>(
            (imageCreativeList as any[]).filter((c) => c.tiktokImageId).map((c) => [c.tiktokImageId, { id: c.id }])
          );
          const existingAdMap = new Map<string, { status: string }>(
            (existingAdList as any[]).map((a) => [a.tiktokId, { status: a.status }])
          );
          this.logger.log(`Pre-fetch: ${adGroupMap.size} adgroups, ${videoCreativeMap.size} videos, ${imageCreativeMap.size} images, ${existingAdMap.size} existing ads`);

          for (const ad of ads) {
            const adgroup = adGroupMap.get(String(ad.adgroup_id));

            if (!adgroup) {
              this.logger.warn(`AdGroup ${ad.adgroup_id} not found, skipping ad ${ad.ad_id}`);
              continue;
            }

            // Creativeを処理（既存のCreativeがあればそれを使用、なければ作成）
            let creativeId: string | null = null;
            if (ad.video_id) {
              const creative = videoCreativeMap.get(ad.video_id);

              if (!creative) {
                const newCreative = await this.prisma.creative.create({
                  data: {
                    advertiserId: advertiser.id,
                    name: `Video ${ad.video_id}`,
                    type: 'VIDEO',
                    tiktokVideoId: ad.video_id,
                    url: ad.video_id || '',
                    filename: `video_${ad.video_id}`,
                  },
                });
                creativeId = newCreative.id;
                videoCreativeMap.set(ad.video_id, { id: newCreative.id });
              } else {
                creativeId = creative.id;
              }
            } else if (ad.image_ids && ad.image_ids.length > 0) {
              const creative = imageCreativeMap.get(ad.image_ids[0]);

              if (!creative) {
                const newCreative = await this.prisma.creative.create({
                  data: {
                    advertiserId: advertiser.id,
                    name: `Image ${ad.image_ids[0]}`,
                    type: 'IMAGE',
                    tiktokImageId: ad.image_ids[0],
                    url: ad.image_ids[0] || '',
                    filename: `image_${ad.image_ids[0]}`,
                  },
                });
                creativeId = newCreative.id;
                imageCreativeMap.set(ad.image_ids[0], { id: newCreative.id });
              } else {
                creativeId = creative.id;
              }
            }

            if (!creativeId) {
              this.logger.warn(`No creative found for ad ${ad.ad_id}, skipping`);
              continue;
            }

            // Smart+ 広告の場合: smart_plus_ad_idをtiktokIdとして使用し、手動設定名を使用
            // これにより、予算最適化で正しい広告名（日付/制作者/CR名/LP名）が使われる
            const isSmartPlusAd = !!ad.smart_plus_ad_id;
            const tiktokIdToUse = isSmartPlusAd ? String(ad.smart_plus_ad_id) : String(ad.ad_id);
            const adNameToUse = isSmartPlusAd
              ? (smartPlusAdNameMap.get(String(ad.smart_plus_ad_id)) || ad.ad_name)
              : ad.ad_name;
            // Smart+広告は smart_plus/ad/get APIのステータスを使用（親広告のステータスではなく素材個別のステータス）
            const statusToUse = isSmartPlusAd
              ? (smartPlusAdStatusMap.get(String(ad.smart_plus_ad_id)) || ad.operation_status)
              : ad.operation_status;

            if (isSmartPlusAd) {
              this.logger.debug(`Smart+ ad detected: ad_id=${ad.ad_id}, smart_plus_ad_id=${ad.smart_plus_ad_id}, name=${adNameToUse}, status=${statusToUse}`);
            }

            // 手動停止検知: upsert前に既存レコードのstatusを確認（事前取得Mapから）
            const existingAd = existingAdMap.get(tiktokIdToUse);
            const wasEnabled = existingAd && !existingAd.status.includes('DISABLE');
            const isNowDisabled = statusToUse.includes('DISABLE');

            await this.prisma.ad.upsert({
              where: { tiktokId: tiktokIdToUse },
              create: {
                tiktokId: tiktokIdToUse,
                adgroupId: adgroup.id,
                name: adNameToUse,
                creativeId,
                adText: ad.ad_text,
                callToAction: ad.call_to_action,
                landingPageUrl: ad.landing_page_url,
                displayName: ad.identity_id,
                status: statusToUse,
                reviewStatus: ad.app_download_status || 'APPROVED',
              },
              update: {
                name: adNameToUse,
                adText: ad.ad_text,
                callToAction: ad.call_to_action,
                landingPageUrl: ad.landing_page_url,
                displayName: ad.identity_id,
                status: statusToUse,
                reviewStatus: ad.app_download_status || 'APPROVED',
              },
            });

            // Smart+フォールバックで重複作成しないよう、Mapにも反映
            existingAdMap.set(tiktokIdToUse, { status: statusToUse });

            // ENABLE → DISABLE に変わった場合、ChangeLogに手動停止を記録
            if (wasEnabled && isNowDisabled) {
              await this.prisma.changeLog.create({
                data: {
                  entityType: 'AD',
                  entityId: tiktokIdToUse,
                  action: 'PAUSE',
                  source: 'MANUAL',
                  reason: `手動停止検知 (${existingAd.status} → ${statusToUse})`,
                  beforeData: { status: existingAd.status },
                  afterData: { status: statusToUse },
                },
              });
              this.logger.log(`手動停止検知: ${adNameToUse} (${tiktokIdToUse}): ${existingAd.status} → ${statusToUse}`);
            }

            adsSynced++;
          }

          // Smart+ Adsのフォールバック同期
          // 通常のad/get APIで取得できないSmart+広告がある場合のみ処理
          // （通常は上記の処理でsmart_plus_ad_idを持つ広告は既に同期済み）
          let smartPlusAdsSynced = 0;
          try {
            const smartPlusAds = await this.tiktokService.getAllSmartPlusAds(
              token.advertiserId,
              token.accessToken,
            );
            this.logger.log(`Checking ${smartPlusAds.length} Smart+ ads for fallback sync`);

            // === Smart+ フォールバック用 pre-fetch ===
            // adGroupMap はmain loopの物を再利用、不足分を追加取得
            const spAdGroupIds = [...new Set(smartPlusAds.map((a: any) => a.adgroup_id ? String(a.adgroup_id) : null).filter(Boolean) as string[])];
            const missingAdGroupIds = spAdGroupIds.filter((id) => !adGroupMap.has(id));
            if (missingAdGroupIds.length > 0) {
              const extra = await this.prisma.adGroup.findMany({
                where: { tiktokId: { in: missingAdGroupIds } },
                select: { id: true, tiktokId: true },
              });
              for (const g of extra) adGroupMap.set(g.tiktokId, g);
            }
            // Smart+ creative_list からvideo/image IDを抽出
            const spVideoIds: string[] = [];
            const spImageIds: string[] = [];
            for (const spAd of smartPlusAds) {
              const enabled = (spAd.creative_list ?? []).find((c: any) => c.material_operation_status === 'ENABLE');
              const ci = enabled?.creative_info;
              const vid = ci?.video_info?.video_id;
              if (vid) spVideoIds.push(String(vid));
              const imgs = ci?.image_info ?? [];
              if (imgs.length > 0) {
                const imgId = imgs[0].web_uri || imgs[0].image_id;
                if (imgId) spImageIds.push(String(imgId));
              }
            }
            const missingVideoIds = [...new Set(spVideoIds.filter((id) => !videoCreativeMap.has(id)))];
            const missingImageIds = [...new Set(spImageIds.filter((id) => !imageCreativeMap.has(id)))];
            if (missingVideoIds.length > 0) {
              const extra = await this.prisma.creative.findMany({
                where: { tiktokVideoId: { in: missingVideoIds } },
                select: { id: true, tiktokVideoId: true },
              });
              for (const c of extra) if (c.tiktokVideoId) videoCreativeMap.set(c.tiktokVideoId, { id: c.id });
            }
            if (missingImageIds.length > 0) {
              const extra = await this.prisma.creative.findMany({
                where: { tiktokImageId: { in: missingImageIds } },
                select: { id: true, tiktokImageId: true },
              });
              for (const c of extra) if (c.tiktokImageId) imageCreativeMap.set(c.tiktokImageId, { id: c.id });
            }
            // Smart+ 既存ad用Map: main loopのexistingAdMapを再利用。不足IDを追加取得
            const spCandidateIds = smartPlusAds.map((a: any) => String(a.smart_plus_ad_id || a.ad_id)).filter(Boolean);
            const missingSpIds = spCandidateIds.filter((id) => !existingAdMap.has(id));
            if (missingSpIds.length > 0) {
              const extra = await this.prisma.ad.findMany({
                where: { tiktokId: { in: missingSpIds } },
                select: { tiktokId: true, status: true },
              });
              for (const a of extra) existingAdMap.set(a.tiktokId, { status: a.status });
            }

            for (const ad of smartPlusAds) {
              // Smart+ AdのIDを決定（smart_plus_ad_id を優先）
              const adId = ad.smart_plus_ad_id || ad.ad_id;
              if (!adId) {
                this.logger.warn(`Smart+ ad has no ID, skipping`);
                continue;
              }

              // 既にDBに存在する場合はスキップ（通常広告同期で既に処理済み）
              if (existingAdMap.has(String(adId))) {
                continue;
              }

              // AdGroupを探す
              if (!ad.adgroup_id) {
                this.logger.warn(`Smart+ ad ${adId} (${ad.ad_name}) has no adgroup_id, skipping`);
                continue;
              }

              const adgroup = adGroupMap.get(String(ad.adgroup_id));

              if (!adgroup) {
                this.logger.warn(`AdGroup ${ad.adgroup_id} not found for Smart+ ad ${adId} (${ad.ad_name}), skipping`);
                continue;
              }

              // Creativeを処理（Smart+ 広告は creative_list から取得）
              let creativeId: string | null = null;

              // creative_list から最初の有効なクリエイティブを取得
              const creativeList = ad.creative_list || [];
              const enabledCreative = creativeList.find(
                (c: any) => c.material_operation_status === 'ENABLE'
              );

              if (enabledCreative?.creative_info) {
                const creativeInfo = enabledCreative.creative_info;
                const videoId = creativeInfo.video_info?.video_id;
                const imageInfo = creativeInfo.image_info;

                if (videoId) {
                  const creative = videoCreativeMap.get(String(videoId));

                  if (!creative) {
                    const newCreative = await this.prisma.creative.create({
                      data: {
                        advertiserId: advertiser.id,
                        name: creativeInfo.material_name || `Video ${videoId}`,
                        type: 'VIDEO',
                        tiktokVideoId: videoId,
                        url: videoId || '',
                        filename: `video_${videoId}`,
                      },
                    });
                    creativeId = newCreative.id;
                    videoCreativeMap.set(String(videoId), { id: newCreative.id });
                  } else {
                    creativeId = creative.id;
                  }
                } else if (imageInfo && imageInfo.length > 0) {
                  // image_info から web_uri を取得してIDとして使用
                  const imageId = imageInfo[0].web_uri || imageInfo[0].image_id;

                  if (imageId) {
                    const creative = imageCreativeMap.get(String(imageId));

                    if (!creative) {
                      const newCreative = await this.prisma.creative.create({
                        data: {
                          advertiserId: advertiser.id,
                          name: creativeInfo.material_name || `Image ${imageId}`,
                          type: 'IMAGE',
                          tiktokImageId: imageId,
                          url: imageId || '',
                          filename: `image_${imageId}`,
                        },
                      });
                      creativeId = newCreative.id;
                      imageCreativeMap.set(String(imageId), { id: newCreative.id });
                    } else {
                      creativeId = creative.id;
                    }
                  }
                }
              }

              if (!creativeId) {
                // 詳細なログを出力して原因を特定しやすくする
                this.logger.warn(`No creative found for Smart+ ad ${adId} (${ad.ad_name}), skipping`);
                this.logger.warn(`  - creative_list length: ${creativeList.length}`);
                this.logger.warn(`  - enabledCreative: ${enabledCreative ? 'found' : 'not found'}`);
                if (enabledCreative?.creative_info) {
                  const ci = enabledCreative.creative_info;
                  this.logger.warn(`  - video_id: ${ci.video_info?.video_id || 'none'}`);
                  this.logger.warn(`  - image_info: ${ci.image_info ? 'exists' : 'none'}`);
                }
                continue;
              }

              // Smart+ Adを作成（tiktokIdにはsmart_plus_ad_idを使用）
              await this.prisma.ad.create({
                data: {
                  tiktokId: String(adId),
                  adgroupId: adgroup.id,
                  name: ad.ad_name,
                  creativeId,
                  adText: ad.ad_text_list?.[0]?.ad_text,
                  callToAction: ad.ad_configuration?.call_to_action_id,
                  landingPageUrl: ad.landing_page_url_list?.[0]?.landing_page_url,
                  displayName: enabledCreative?.creative_info?.identity_id,
                  status: ad.operation_status,
                  reviewStatus: 'APPROVED',
                },
              });
              existingAdMap.set(String(adId), { status: ad.operation_status });
              smartPlusAdsSynced++;
              this.logger.log(`Fallback synced Smart+ ad: ${ad.ad_name} (${adId})`);
            }

            if (smartPlusAdsSynced > 0) {
              this.logger.log(`Fallback synced ${smartPlusAdsSynced} Smart+ ads for ${token.advertiserId}`);
            }
          } catch (error) {
            this.logger.error(`Failed to sync Smart+ ads for ${token.advertiserId}:`, error.message);
          }

          totalCampaigns += campaignsSynced;
          totalAdgroups += adgroupsSynced;
          totalAds += adsSynced + smartPlusAdsSynced;

          this.logger.log(
            `Synced for ${token.advertiserId}: ${campaignsSynced} campaigns, ${adgroupsSynced} adgroups, ${adsSynced} regular ads, ${smartPlusAdsSynced} Smart+ ads`,
          );
        } catch (error) {
          this.logger.error(`Failed to sync entities for ${token.advertiserId}:`, error.message);
          errorCount++;
        }
      }

      this.logger.log(
        `Daily entity sync completed. Total: ${totalCampaigns} campaigns, ${totalAdgroups} adgroups, ${totalAds} ads. Errors: ${errorCount}`,
      );

      // ===== 新機能: AdPerformance 初期化 =====
      if (this.configService.get('FEATURE_AD_PERFORMANCE_ENABLED') === 'true') {
        try {
          this.logger.log('Starting AdPerformance initialization...');
          await this.adPerformanceService.initializeAllNewAdPerformances();
          this.logger.log('AdPerformance initialization completed');
        } catch (error) {
          // 新機能のエラーは既存処理に影響させない
          this.logger.error('AdPerformance initialization failed:', error.message);
        }
      }
    } catch (error) {
      this.logger.error('Failed to execute daily entity sync:', error);
    } finally {
      batchJobLock.release('daily-entity-sync');
      this.logger.log('Entity sync job lock released');
    }
  }

  /**
   * 日次レポート取得バッチジョブ
   * 毎日0時5分（日本時間）に実行
   */
  @Cron('5 0 * * *', {
    name: 'daily-report-fetch',
    timeZone: 'Asia/Tokyo',
  })
  async scheduleDailyReportFetch() {
    const jobName = 'daily-report-fetch';

    // S-01: 同時実行競合チェック（ロック機能統一 - batchJobLockのみ使用）
    // タイムアウトを30分に延長（大量データ処理対応）
    if (!batchJobLock.acquire(jobName, 1800000)) { // 30分タイムアウト
      const lockStartTime = batchJobLock.getLockStartTime(jobName);
      this.logger.warn(
        `[S-01] Previous report fetch job is still running (started: ${lockStartTime?.toISOString()}). Skipping...`
      );
      return;
    }

    this.logger.log('Starting daily report fetch batch job');

    try {
      // データベースから全ての有効なOAuthTokenを取得
      const oauthTokens = await this.prisma.oAuthToken.findMany({
        where: {
          expiresAt: {
            gt: new Date(),
          },
        },
        select: {
          advertiserId: true,
          accessToken: true,
        },
      });

      if (oauthTokens.length === 0) {
        this.logger.warn('No active advertisers found. Skipping report fetch.');
        return;
      }

      // 過去7日間のデータを取得（JST基準で正しく計算）
      const now = new Date();
      const jstOffset = 9 * 60 * 60 * 1000; // JSTはUTC+9時間
      const jstNow = new Date(now.getTime() + jstOffset);

      // JST基準で昨日と7日前を計算
      const endDateJST = new Date(jstNow);
      endDateJST.setUTCDate(endDateJST.getUTCDate() - 1); // 昨日
      const startDateJST = new Date(jstNow);
      startDateJST.setUTCDate(startDateJST.getUTCDate() - 7); // 7日前

      const startDateStr = startDateJST.toISOString().split('T')[0];
      const endDateStr = endDateJST.toISOString().split('T')[0];

      const dataLevels: Array<'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD'> = [
        'AUCTION_CAMPAIGN',
        'AUCTION_ADGROUP',
        'AUCTION_AD',
      ];

      let successCount = 0;
      let errorCount = 0;
      const results: Array<{
        advertiserId: string;
        dataLevel: string;
        status: 'success' | 'empty' | 'error';
        recordCount?: number;
        error?: string;
      }> = [];

      // 各Advertiserとデータレベルに対してレポートを取得
      for (const token of oauthTokens) {
        for (const dataLevel of dataLevels) {
          try {
            this.logger.log(
              `Fetching ${dataLevel} report for advertiser ${token.advertiserId} (${startDateStr} ~ ${endDateStr})`,
            );

            // レポートデータを取得
            const reportData = await this.tiktokService.getAllReportData(
              token.advertiserId,
              token.accessToken,
              {
                dataLevel,
                startDate: startDateStr,
                endDate: endDateStr,
              },
            );

            // データベースに保存
            if (reportData.length > 0) {
              await this.tiktokService.saveReportMetrics(reportData, dataLevel, token.advertiserId);
              this.logger.log(
                `Successfully saved ${reportData.length} metrics for ${token.advertiserId} - ${dataLevel}`,
              );
              successCount++;
              results.push({ advertiserId: token.advertiserId, dataLevel, status: 'success', recordCount: reportData.length });
            } else {
              this.logger.warn(
                `No data returned for ${token.advertiserId} - ${dataLevel}`,
              );
              results.push({ advertiserId: token.advertiserId, dataLevel, status: 'empty', recordCount: 0 });
            }
          } catch (error) {
            this.logger.error(
              `Failed to fetch/save report for ${token.advertiserId} - ${dataLevel}:`,
              error.message,
            );
            errorCount++;
            results.push({ advertiserId: token.advertiserId, dataLevel, status: 'error', error: error?.message ?? String(error) });
          }
        }

        // Smart+広告のメトリクスを取得
        try {
          this.logger.log(
            `Fetching Smart+ ad metrics for advertiser ${token.advertiserId} (${startDateStr} ~ ${endDateStr})`,
          );

          // Smart+レポートAPIはstat_time_day分解に未対応のため、
          // 7日窓で取得するとsaveSmartPlusMetrics側で全日合計が statDate=昨日 として1行に潰れる
          // （ゾンビMetric問題）。必ず「昨日のみ」の1日窓で呼ぶ。
          const smartPlusMetrics = await this.tiktokService.getAllSmartPlusAdMetrics(
            token.advertiserId,
            token.accessToken,
            {
              startDate: endDateStr,
              endDate: endDateStr,
            },
          );

          if (smartPlusMetrics.length > 0) {
            await this.tiktokService.saveSmartPlusMetrics(smartPlusMetrics, token.advertiserId);
            this.logger.log(
              `Successfully saved ${smartPlusMetrics.length} Smart+ metrics for ${token.advertiserId}`,
            );
            successCount++;
            results.push({ advertiserId: token.advertiserId, dataLevel: 'SMART_PLUS', status: 'success', recordCount: smartPlusMetrics.length });
          } else {
            this.logger.warn(
              `No Smart+ metrics returned for ${token.advertiserId}`,
            );
            results.push({ advertiserId: token.advertiserId, dataLevel: 'SMART_PLUS', status: 'empty', recordCount: 0 });
          }
        } catch (error) {
          this.logger.error(
            `Failed to fetch/save Smart+ metrics for ${token.advertiserId}:`,
            error.message,
          );
          errorCount++;
          results.push({ advertiserId: token.advertiserId, dataLevel: 'SMART_PLUS', status: 'error', error: error?.message ?? String(error) });
        }
      }

      this.logger.log(
        `Daily report fetch completed. Success: ${successCount}, Errors: ${errorCount}`,
      );

      // S-03: 部分的同期失敗の警告
      if (errorCount > 0 && successCount > 0) {
        this.logger.warn(
          `[S-03] Partial sync failure: ${errorCount} out of ${successCount + errorCount} operations failed`,
        );
      }

      (this as any)._lastDailyReportSummary = {
        startDate: startDateStr,
        endDate: endDateStr,
        successCount,
        errorCount,
        results,
      };

      // ===== 新機能: 広告パフォーマンス分析 =====
      if (this.configService.get('FEATURE_AD_PERFORMANCE_ENABLED') === 'true') {
        try {
          this.logger.log('Starting AdPerformance analysis...');
          // 累計パフォーマンスを更新
          await this.adPerformanceService.updateAllAdPerformances();
          // CPA乖離と消化額トリガーをチェック
          await this.adPerformanceService.checkAllDeviationsAndTriggers();
          this.logger.log('AdPerformance analysis completed');
        } catch (error) {
          // 新機能のエラーは既存処理に影響させない
          this.logger.error('AdPerformance analysis failed:', error.message);
        }
      }
    } catch (error) {
      this.logger.error('Failed to execute daily report fetch:', error);
    } finally {
      batchJobLock.release('daily-report-fetch');
      this.logger.log('Report fetch job lock released');
    }
  }

  /**
   * 手動でレポート取得を実行
   */
  async manualReportFetch(
    advertiserId: string,
    accessToken: string,
    dataLevel: 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD',
    startDate: string,
    endDate: string,
  ) {
    this.logger.log(`Manual report fetch: ${advertiserId} - ${dataLevel}`);

    try {
      const reportData = await this.tiktokService.getAllReportData(
        advertiserId,
        accessToken,
        {
          dataLevel,
          startDate,
          endDate,
        },
      );

      if (reportData.length > 0) {
        await this.tiktokService.saveReportMetrics(reportData, dataLevel, advertiserId);
        this.logger.log(`Saved ${reportData.length} metrics`);
      }

      return {
        success: true,
        recordCount: reportData.length,
      };
    } catch (error) {
      this.logger.error('Manual report fetch failed:', error);
      throw error;
    }
  }
}
