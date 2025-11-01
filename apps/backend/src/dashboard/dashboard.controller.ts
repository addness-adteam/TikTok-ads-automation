import { Controller, Get, Logger } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('api/dashboard')
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * ダッシュボードデータ取得
   * 固定トークンで全Advertiserのデータを集約して返す
   * GET /api/dashboard
   */
  @Get()
  async getDashboardData() {
    this.logger.log('Dashboard data requested');

    try {
      const data = await this.dashboardService.getAggregatedDashboardData();
      return {
        success: true,
        data,
      };
    } catch (error) {
      this.logger.error('Failed to get dashboard data', error);
      return {
        success: false,
        error: error.message || 'Failed to fetch dashboard data',
      };
    }
  }
}
