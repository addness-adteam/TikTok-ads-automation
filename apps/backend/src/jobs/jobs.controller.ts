import { Controller, Post, Get, Logger, Query } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { TiktokService } from '../tiktok/tiktok.service';
import { IntradayOptimizationService } from '../intraday-optimization/intraday-optimization.service';

@Controller('jobs')
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly prisma: PrismaService,
    private readonly tiktokService: TiktokService,
    private readonly intradayOptimizationService: IntradayOptimizationService,
  ) {}

  /**
   * 無期限トークンのexpiresAtを更新
   * POST /jobs/update-token-expiry
   */
  @Post('update-token-expiry')
  async updateTokenExpiry() {
    try {
      // 全てのトークンのexpiresAtを2099年12月31日に更新
      const futureDate = new Date('2099-12-31T23:59:59Z');

      const result = await this.prisma.oAuthToken.updateMany({
        data: {
          expiresAt: futureDate,
        },
      });

      this.logger.log(`Updated expiresAt for ${result.count} tokens to ${futureDate.toISOString()}`);

      return {
        success: true,
        message: `Updated ${result.count} tokens to expire at ${futureDate.toISOString()}`,
        count: result.count,
      };
    } catch (error) {
      this.logger.error('Failed to update token expiry', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * データ収集の診断情報
   * GET /jobs/diagnostics
   */
  @Get('diagnostics')
  async getDiagnostics() {
    try {
      // OAuthTokenの状況確認
      const allTokens = await this.prisma.oAuthToken.findMany({
        select: {
          advertiserId: true,
          expiresAt: true,
          scope: true,
        },
      });

      const activeTokens = await this.prisma.oAuthToken.findMany({
        where: {
          expiresAt: {
            gt: new Date(),
          },
        },
        select: {
          advertiserId: true,
          expiresAt: true,
          scope: true,
        },
      });

      // メトリクスの状況確認
      const metricCount = await this.prisma.metric.count();
      const latestMetric = await this.prisma.metric.findFirst({
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          entityType: true,
          statDate: true,
          impressions: true,
          spend: true,
          createdAt: true,
        },
      });

      return {
        oauthTokens: {
          total: allTokens.length,
          active: activeTokens.length,
          tokens: allTokens,
        },
        metrics: {
          total: metricCount,
          latest: latestMetric,
        },
      };
    } catch (error) {
      this.logger.error('Diagnostics failed', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * バッチジョブを手動で実行
   * POST /jobs/run-daily-report
   */
  @Post('run-daily-report')
  async runDailyReport() {
    this.logger.log('Manual trigger: Running daily report fetch batch job');

    try {
      await this.schedulerService.scheduleDailyReportFetch();
      return {
        success: true,
        message: 'Daily report fetch batch job completed',
      };
    } catch (error) {
      this.logger.error('Manual batch job failed', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * エンティティ同期バッチジョブを手動で実行（Smart+広告を含む）
   * POST /jobs/run-entity-sync
   */
  @Post('run-entity-sync')
  async runEntitySync() {
    this.logger.log('Manual trigger: Running daily entity sync batch job (including Smart+ ads)');

    try {
      await this.schedulerService.scheduleDailyEntitySync();
      return {
        success: true,
        message: 'Daily entity sync batch job completed (including Smart+ ads)',
      };
    } catch (error) {
      this.logger.error('Manual entity sync failed', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 特定のAdvertiserのトークン情報を確認
   * GET /jobs/check-token?advertiserId=xxx
   */
  @Get('check-token')
  async checkToken(@Query('advertiserId') advertiserId?: string) {
    try {
      const token = advertiserId
        ? await this.prisma.oAuthToken.findFirst({
            where: {
              advertiserId: advertiserId,
            },
            select: {
              advertiserId: true,
              expiresAt: true,
              scope: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : await this.prisma.oAuthToken.findFirst({
            select: {
              advertiserId: true,
              expiresAt: true,
              scope: true,
              createdAt: true,
              updatedAt: true,
            },
          });

      if (!token) {
        return {
          success: false,
          error: advertiserId
            ? `Token not found for advertiser: ${advertiserId}`
            : 'No token found',
        };
      }

      // scopeをパース
      let parsedScope: any = null;
      if (token.scope) {
        try {
          parsedScope = JSON.parse(token.scope);
        } catch (e) {
          parsedScope = token.scope;
        }
      }

      return {
        success: true,
        advertiserId: token.advertiserId,
        expiresAt: token.expiresAt,
        isExpired: token.expiresAt < new Date(),
        scope: parsedScope,
        createdAt: token.createdAt,
        updatedAt: token.updatedAt,
      };
    } catch (error) {
      this.logger.error('Failed to check token', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 特定のAdvertiserでレポートデータを取得テスト
   * GET /jobs/test-report?advertiserId=xxx
   */
  @Get('test-report')
  async testReport(
    @Query('advertiserId') advertiserId?: string,
    @Query('dataLevel') dataLevel?: 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD',
  ) {
    try {
      // 指定されたAdvertiserIDまたは最初の有効なトークンを取得
      const token = advertiserId
        ? await this.prisma.oAuthToken.findFirst({
            where: {
              advertiserId: advertiserId,
              expiresAt: {
                gt: new Date(),
              },
            },
          })
        : await this.prisma.oAuthToken.findFirst({
            where: {
              expiresAt: {
                gt: new Date(),
              },
            },
          });

      if (!token) {
        return {
          success: false,
          error: advertiserId
            ? `No active token found for advertiser: ${advertiserId}`
            : 'No active token found',
        };
      }

      // デフォルトはAUCTION_ADレベル
      const level = dataLevel || 'AUCTION_AD';

      this.logger.log(`Testing report API for advertiser: ${token.advertiserId}, level: ${level}`);

      // 過去7日間のレポートデータを取得（JST基準で正しく計算）
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

      const reportData = await this.tiktokService.getAllReportData(
        token.advertiserId,
        token.accessToken,
        {
          dataLevel: level,
          startDate: startDateStr,
          endDate: endDateStr,
        },
      );

      return {
        success: true,
        advertiserId: token.advertiserId,
        dateRange: {
          start: startDateStr,
          end: endDateStr,
        },
        recordCount: reportData.length,
        data: reportData,
      };
    } catch (error) {
      this.logger.error('Failed to test report', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null,
      };
    }
  }

  /**
   * TikTok APIから実際のCampaign/AdGroup/Ad数を確認
   * GET /jobs/check-entities?advertiserId=xxx
   */
  @Get('check-entities')
  async checkEntities(@Query('advertiserId') advertiserId?: string) {
    try {
      // 指定されたAdvertiserIDまたは最初の有効なトークンを取得
      const token = advertiserId
        ? await this.prisma.oAuthToken.findFirst({
            where: {
              advertiserId: advertiserId,
              expiresAt: {
                gt: new Date(),
              },
            },
          })
        : await this.prisma.oAuthToken.findFirst({
            where: {
              expiresAt: {
                gt: new Date(),
              },
            },
          });

      if (!token) {
        return {
          success: false,
          error: advertiserId
            ? `No active token found for advertiser: ${advertiserId}`
            : 'No active token found',
        };
      }

      this.logger.log(`Checking entities for advertiser: ${token.advertiserId}`);

      // Campaign一覧を取得
      const campaignsResult = await this.tiktokService.getCampaigns(
        token.advertiserId,
        token.accessToken,
      );

      // AdGroup一覧を取得
      const adgroupsResult = await this.tiktokService.getAdGroups(
        token.advertiserId,
        token.accessToken,
      );

      // Ad一覧を取得
      const adsResult = await this.tiktokService.getAds(
        token.advertiserId,
        token.accessToken,
      );

      return {
        success: true,
        advertiserId: token.advertiserId,
        campaigns: {
          count: campaignsResult.data?.list?.length || 0,
          data: campaignsResult.data?.list || [],
        },
        adgroups: {
          count: adgroupsResult.data?.list?.length || 0,
          data: adgroupsResult.data?.list || [],
        },
        ads: {
          count: adsResult.data?.list?.length || 0,
          data: adsResult.data?.list || [],
        },
      };
    } catch (error) {
      this.logger.error('Failed to check entities', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null,
      };
    }
  }

  /**
   * TikTok APIから既存のCampaign/AdGroup/AdをDBに同期
   * POST /jobs/sync-entities?advertiserId=xxx
   */
  @Post('sync-entities')
  async syncEntities(@Query('advertiserId') advertiserId?: string) {
    try {
      // 指定されたAdvertiserIDまたは全ての有効なトークンを取得
      const tokens = advertiserId
        ? await this.prisma.oAuthToken.findMany({
            where: {
              advertiserId: advertiserId,
              expiresAt: {
                gt: new Date(),
              },
            },
          })
        : await this.prisma.oAuthToken.findMany({
            where: {
              expiresAt: {
                gt: new Date(),
              },
            },
          });

      if (tokens.length === 0) {
        return {
          success: false,
          error: advertiserId
            ? `No active token found for advertiser: ${advertiserId}`
            : 'No active tokens found',
        };
      }

      const results: any[] = [];

      for (const token of tokens) {
        this.logger.log(`Syncing entities for advertiser: ${token.advertiserId}`);

        try {
          // まずAdvertiserレコードを確実に存在させる
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
                status: campaign.operation_status,
              },
              update: {
                name: campaign.campaign_name,
                objectiveType: campaign.objective_type,
                budgetMode: campaign.budget_mode,
                budget: campaign.budget || null,
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
            // まずCampaignが存在するか確認
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
                bidType: adgroup.bid_type,
                bidPrice: adgroup.bid_price,
                targeting: adgroup as any, // 全データを保存
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
          try {
            const smartPlusAdsForNames = await this.tiktokService.getAllSmartPlusAds(
              token.advertiserId,
              token.accessToken,
            );
            for (const spAd of smartPlusAdsForNames) {
              if (spAd.smart_plus_ad_id && spAd.ad_name) {
                smartPlusAdNameMap.set(String(spAd.smart_plus_ad_id), spAd.ad_name);
              }
            }
            this.logger.log(`Built Smart+ ad name map with ${smartPlusAdNameMap.size} entries`);
          } catch (error) {
            this.logger.warn(`Failed to fetch Smart+ ads for name mapping: ${error.message}`);
          }

          for (const ad of ads) {
            // まずAdGroupが存在するか確認
            const adgroup = await this.prisma.adGroup.findUnique({
              where: { tiktokId: String(ad.adgroup_id) },
            });

            if (!adgroup) {
              this.logger.warn(`AdGroup ${ad.adgroup_id} not found, skipping ad ${ad.ad_id}`);
              continue;
            }

            // Creativeを処理（既存のCreativeがあればそれを使用、なければダミーを作成）
            let creativeId: string | null = null;
            if (ad.video_id) {
              const creative = await this.prisma.creative.findFirst({
                where: { tiktokVideoId: ad.video_id },
              });

              if (!creative) {
                // Creativeが存在しない場合は作成
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
              } else {
                creativeId = creative.id;
              }
            } else if (ad.image_ids && ad.image_ids.length > 0) {
              const creative = await this.prisma.creative.findFirst({
                where: { tiktokImageId: ad.image_ids[0] },
              });

              if (!creative) {
                // Creativeが存在しない場合は作成
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

            if (isSmartPlusAd) {
              this.logger.debug(`Smart+ ad detected: ad_id=${ad.ad_id}, smart_plus_ad_id=${ad.smart_plus_ad_id}, name=${adNameToUse}`);
            }

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
                status: ad.operation_status,
                reviewStatus: ad.app_download_status || 'APPROVED',
              },
              update: {
                name: adNameToUse,
                adText: ad.ad_text,
                callToAction: ad.call_to_action,
                landingPageUrl: ad.landing_page_url,
                displayName: ad.identity_id,
                status: ad.operation_status,
                reviewStatus: ad.app_download_status || 'APPROVED',
              },
            });
            adsSynced++;
          }

          results.push({
            advertiserId: token.advertiserId,
            success: true,
            campaigns: campaignsSynced,
            adgroups: adgroupsSynced,
            ads: adsSynced,
          });

          this.logger.log(
            `Synced for ${token.advertiserId}: ${campaignsSynced} campaigns, ${adgroupsSynced} adgroups, ${adsSynced} ads`,
          );
        } catch (error) {
          this.logger.error(`Failed to sync entities for ${token.advertiserId}`, error);
          results.push({
            advertiserId: token.advertiserId,
            success: false,
            error: error.message,
          });
        }
      }

      return {
        success: true,
        message: 'Entity synchronization completed',
        results,
      };
    } catch (error) {
      this.logger.error('Failed to sync entities', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ============================================================================
  // 日中CPA最適化関連エンドポイント
  // ============================================================================

  /**
   * 日中CPAチェックを実行（15:00用）
   * POST /jobs/intraday-cpa-check
   */
  @Post('intraday-cpa-check')
  async runIntradayCPACheck() {
    this.logger.log('Manual trigger: Running intraday CPA check');

    try {
      const result = await this.intradayOptimizationService.executeIntradayCPACheck();
      return {
        success: true,
        message: 'Intraday CPA check completed',
        data: result,
      };
    } catch (error) {
      this.logger.error('Intraday CPA check failed', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 日中停止した広告の配信再開（23:59用）
   * POST /jobs/intraday-resume
   */
  @Post('intraday-resume')
  async runIntradayResume() {
    this.logger.log('Manual trigger: Running intraday ad resume');

    try {
      const result = await this.intradayOptimizationService.executeIntradayResume();
      return {
        success: true,
        message: 'Intraday ad resume completed',
        data: result,
      };
    } catch (error) {
      this.logger.error('Intraday ad resume failed', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 日中削減した予算の復元（翌日0:00用）
   * POST /jobs/intraday-budget-restore
   */
  @Post('intraday-budget-restore')
  async runIntradayBudgetRestore() {
    this.logger.log('Manual trigger: Running intraday budget restore');

    try {
      const result = await this.intradayOptimizationService.executeIntradayBudgetRestore();
      return {
        success: true,
        message: 'Intraday budget restore completed',
        data: result,
      };
    } catch (error) {
      this.logger.error('Intraday budget restore failed', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
