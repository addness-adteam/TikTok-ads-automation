import { Controller, Post, Body, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { BudgetMonitoringService } from './budget-monitoring.service';
import { ConfigService } from '@nestjs/config';

@Controller('api/budget-monitoring')
export class BudgetMonitoringController {
  private readonly logger = new Logger(BudgetMonitoringController.name);

  constructor(
    private readonly service: BudgetMonitoringService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 予算異常チェック実行
   * POST /api/budget-monitoring/check
   */
  @Post('check')
  async checkBudgets(@Body() body: { dryRun?: boolean }) {
    this.logger.log(`[BudgetMonitor] Check requested (dryRun: ${body?.dryRun})`);
    try {
      const accessToken =
        this.configService.get<string>('TIKTOK_ACCESS_TOKEN') ||
        '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
      const result = await this.service.monitorAllBudgets(accessToken, body?.dryRun);
      return { success: true, data: result };
    } catch (error) {
      this.logger.error('[BudgetMonitor] Check failed:', error);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
