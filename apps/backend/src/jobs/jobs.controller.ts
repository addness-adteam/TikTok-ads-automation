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
}
