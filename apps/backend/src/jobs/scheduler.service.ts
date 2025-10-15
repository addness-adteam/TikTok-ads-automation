import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TiktokService } from '../tiktok/tiktok.service';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tiktokService: TiktokService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    this.logger.log('Scheduler Service initialized');
  }

  /**
   * 日次レポート取得バッチジョブ
   * 毎日午前9時に実行（REPORTING_BATCH_CRON環境変数で設定可能）
   */
  @Cron(process.env.REPORTING_BATCH_CRON || '0 9 * * *', {
    name: 'daily-report-fetch',
    timeZone: 'Asia/Tokyo',
  })
  async scheduleDailyReportFetch() {
    if (this.isRunning) {
      this.logger.warn('Previous batch job is still running. Skipping...');
      return;
    }

    this.isRunning = true;
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

      // 前日のデータを取得
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0];

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
              `Fetching ${dataLevel} report for advertiser ${token.advertiserId} (${dateStr})`,
            );

            // レポートデータを取得
            const reportData = await this.tiktokService.getAllReportData(
              token.advertiserId,
              token.accessToken,
              {
                dataLevel,
                startDate: dateStr,
                endDate: dateStr,
              },
            );

            // データベースに保存
            if (reportData.length > 0) {
              await this.tiktokService.saveReportMetrics(reportData, dataLevel);
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
      this.isRunning = false;
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
        await this.tiktokService.saveReportMetrics(reportData, dataLevel);
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
