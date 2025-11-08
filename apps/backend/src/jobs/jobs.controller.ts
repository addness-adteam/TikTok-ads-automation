import { Controller, Post, Get, Logger } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('jobs')
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly prisma: PrismaService,
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
}
