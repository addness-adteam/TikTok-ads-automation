import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TiktokService } from '../tiktok/tiktok.service';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private isSyncRunning = false;
  private isReportRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tiktokService: TiktokService,
    private readonly configService: ConfigService,
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
    if (this.isSyncRunning) {
      this.logger.warn('Previous entity sync job is still running. Skipping...');
      return;
    }

    this.isSyncRunning = true;
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

          // AdGroupを取得してDBに保存
          const adgroupsResult = await this.tiktokService.getAdGroups(
            token.advertiserId,
            token.accessToken,
          );

          const adgroups = adgroupsResult.data?.list || [];
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

          // Adを取得してDBに保存
          const adsResult = await this.tiktokService.getAds(
            token.advertiserId,
            token.accessToken,
          );

          const ads = adsResult.data?.list || [];
          let adsSynced = 0;

          for (const ad of ads) {
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

            await this.prisma.ad.upsert({
              where: { tiktokId: String(ad.ad_id) },
              create: {
                tiktokId: String(ad.ad_id),
                adgroupId: adgroup.id,
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

          // Smart+ Adsを取得してDBに保存
          let smartPlusAdsSynced = 0;
          try {
            const smartPlusAdsResult = await this.tiktokService.getSmartPlusAds(
              token.advertiserId,
              token.accessToken,
            );

            const smartPlusAds = smartPlusAdsResult.data?.list || [];
            this.logger.log(`Retrieved ${smartPlusAds.length} Smart+ ads for ${token.advertiserId}`);

            for (const ad of smartPlusAds) {
              // Smart+ AdのIDを決定（smart_plus_ad_id を優先）
              const adId = ad.smart_plus_ad_id || ad.ad_id;
              if (!adId) {
                this.logger.warn(`Smart+ ad has no ID, skipping`);
                continue;
              }

              // AdGroupを探す
              if (!ad.adgroup_id) {
                this.logger.warn(`Smart+ ad ${adId} has no adgroup_id, skipping`);
                continue;
              }

              const adgroup = await this.prisma.adGroup.findUnique({
                where: { tiktokId: String(ad.adgroup_id) },
              });

              if (!adgroup) {
                this.logger.warn(`AdGroup ${ad.adgroup_id} not found for Smart+ ad ${adId}, skipping`);
                continue;
              }

              // Creativeを処理
              let creativeId: string | null = null;
              if (ad.video_id) {
                const creative = await this.prisma.creative.findFirst({
                  where: { tiktokVideoId: ad.video_id },
                });

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
                } else {
                  creativeId = creative.id;
                }
              } else if (ad.image_ids && ad.image_ids.length > 0) {
                const creative = await this.prisma.creative.findFirst({
                  where: { tiktokImageId: ad.image_ids[0] },
                });

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
                } else {
                  creativeId = creative.id;
                }
              }

              if (!creativeId) {
                this.logger.warn(`No creative found for Smart+ ad ${adId}, skipping`);
                continue;
              }

              // Smart+ Adをupsert（tiktokIdにはsmart_plus_ad_idを使用）
              await this.prisma.ad.upsert({
                where: { tiktokId: String(adId) },
                create: {
                  tiktokId: String(adId),
                  adgroupId: adgroup.id,
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
              smartPlusAdsSynced++;
            }

            this.logger.log(`Synced ${smartPlusAdsSynced} Smart+ ads for ${token.advertiserId}`);
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
    } catch (error) {
      this.logger.error('Failed to execute daily entity sync:', error);
    } finally {
      this.isSyncRunning = false;
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
    if (this.isReportRunning) {
      this.logger.warn('Previous report fetch job is still running. Skipping...');
      return;
    }

    this.isReportRunning = true;
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
            } else {
              this.logger.warn(
                `No data returned for ${token.advertiserId} - ${dataLevel}`,
              );
            }
          } catch (error) {
            this.logger.error(
              `Failed to fetch/save report for ${token.advertiserId} - ${dataLevel}:`,
              error.message,
            );
            errorCount++;
          }
        }
      }

      this.logger.log(
        `Daily report fetch completed. Success: ${successCount}, Errors: ${errorCount}`,
      );
    } catch (error) {
      this.logger.error('Failed to execute daily report fetch:', error);
    } finally {
      this.isReportRunning = false;
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
