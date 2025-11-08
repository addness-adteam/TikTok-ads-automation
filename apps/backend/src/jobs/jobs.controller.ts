import { Controller, Post, Get, Logger, Query } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { TiktokService } from '../tiktok/tiktok.service';

@Controller('jobs')
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly prisma: PrismaService,
    private readonly tiktokService: TiktokService,
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
  async testReport(@Query('advertiserId') advertiserId?: string) {
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

      this.logger.log(`Testing report API for advertiser: ${token.advertiserId}`);

      // 過去7日間のレポートデータを取得
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - 1);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      const reportData = await this.tiktokService.getAllReportData(
        token.advertiserId,
        token.accessToken,
        {
          dataLevel: 'AUCTION_CAMPAIGN',
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
          await this.prisma.advertiser.upsert({
            where: { tiktokAdvertiserId: token.advertiserId },
            create: {
              tiktokAdvertiserId: token.advertiserId,
              name: `Advertiser ${token.advertiserId}`,
            },
            update: {},
          });

          // Campaignを取得してDBに保存
          const campaignsResult = await this.tiktokService.getCampaigns(
            token.advertiserId,
            token.accessToken,
          );

          const campaigns = campaignsResult.data?.list || [];
          let campaignsSynced = 0;

          for (const campaign of campaigns) {
            await this.prisma.campaign.upsert({
              where: { tiktokId: String(campaign.campaign_id) },
              create: {
                tiktokId: String(campaign.campaign_id),
                advertiserId: token.advertiserId,
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

          // AdGroupを取得してDBに保存
          const adgroupsResult = await this.tiktokService.getAdGroups(
            token.advertiserId,
            token.accessToken,
          );

          const adgroups = adgroupsResult.data?.list || [];
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
                campaignId: String(adgroup.campaign_id),
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

          // Adを取得してDBに保存
          const adsResult = await this.tiktokService.getAds(
            token.advertiserId,
            token.accessToken,
          );

          const ads = adsResult.data?.list || [];
          let adsSynced = 0;

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
                    advertiserId: token.advertiserId,
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
                    advertiserId: token.advertiserId,
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

            await this.prisma.ad.upsert({
              where: { tiktokId: String(ad.ad_id) },
              create: {
                tiktokId: String(ad.ad_id),
                adgroupId: String(ad.adgroup_id),
                name: ad.ad_name,
                creativeId,
                adText: ad.ad_text,
                callToAction: ad.call_to_action,
                landingPageUrl: ad.landing_page_url,
                displayName: ad.identity_id,
                status: ad.operation_status,
                reviewStatus: ad.app_download_status || 'APPROVED',
              },
              update: {
                name: ad.ad_name,
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
}
