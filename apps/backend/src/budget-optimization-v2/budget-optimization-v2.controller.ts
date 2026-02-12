import { Controller, Post, Get, Body, Param, Query, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { BudgetOptimizationV2Service } from './budget-optimization-v2.service';
import { ConfigService } from '@nestjs/config';

@Controller('api/budget-optimization-v2')
export class BudgetOptimizationV2Controller {
  private readonly logger = new Logger(BudgetOptimizationV2Controller.name);

  constructor(
    private readonly service: BudgetOptimizationV2Service,
    private readonly configService: ConfigService,
  ) {}

  private getAccessToken(providedToken?: string): string {
    const token = providedToken || this.configService.get<string>('TIKTOK_ACCESS_TOKEN');
    if (!token) throw new Error('Access token is required');
    return token;
  }

  /**
   * 特定Advertiserの毎時予算調整を実行
   * POST /api/budget-optimization-v2/execute/:advertiserId
   */
  @Post('execute/:advertiserId')
  async execute(
    @Param('advertiserId') advertiserId: string,
    @Body('accessToken') accessToken?: string,
    @Body('dryRun') dryRun?: boolean,
  ) {
    this.logger.log(`[V2] Execute requested for ${advertiserId} (dryRun: ${dryRun})`);
    try {
      const token = this.getAccessToken(accessToken);
      const result = await this.service.executeHourlyOptimization(advertiserId, token, dryRun === true);
      return { success: true, data: result };
    } catch (error) {
      this.logger.error(`[V2] Execute failed for ${advertiserId}:`, error);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 全対象アカウントの毎時予算調整を実行
   * POST /api/budget-optimization-v2/execute-all
   */
  @Post('execute-all')
  async executeAll(
    @Body('accessToken') accessToken?: string,
    @Body('dryRun') dryRun?: boolean,
  ) {
    this.logger.log(`[V2] Execute-all requested (dryRun: ${dryRun})`);
    try {
      const token = this.getAccessToken(accessToken);
      const result = await this.service.executeAll(token, dryRun === true);
      return { success: true, data: result };
    } catch (error) {
      this.logger.error('[V2] Execute-all failed:', error);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * ドライラン（実際のAPI呼び出しなし）
   * POST /api/budget-optimization-v2/dry-run/:advertiserId
   */
  @Post('dry-run/:advertiserId')
  async dryRun(
    @Param('advertiserId') advertiserId: string,
    @Body('accessToken') accessToken?: string,
  ) {
    this.logger.log(`[V2] Dry-run requested for ${advertiserId}`);
    try {
      const token = this.getAccessToken(accessToken);
      const result = await this.service.executeHourlyOptimization(advertiserId, token, true);
      return { success: true, dryRun: true, data: result };
    } catch (error) {
      this.logger.error(`[V2] Dry-run failed for ${advertiserId}:`, error);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * スナップショット閲覧
   * GET /api/budget-optimization-v2/snapshots/:advertiserId?date=YYYY-MM-DD
   */
  @Get('snapshots/:advertiserId')
  async getSnapshots(
    @Param('advertiserId') advertiserId: string,
    @Query('date') date?: string,
  ) {
    try {
      const snapshots = await this.service.getSnapshots(advertiserId, date);
      return { success: true, data: snapshots };
    } catch (error) {
      this.logger.error(`[V2] Get snapshots failed:`, error);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
