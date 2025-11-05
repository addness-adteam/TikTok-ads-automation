import { Controller, Post, Body, Logger, Param } from '@nestjs/common';
import { OptimizationService } from './optimization.service';
import { ConfigService } from '@nestjs/config';

@Controller('api/optimization')
export class OptimizationController {
  private readonly logger = new Logger(OptimizationController.name);

  constructor(
    private readonly optimizationService: OptimizationService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 予算調整を実行
   * POST /api/optimization/execute
   * Body: { accessToken?: string }（オプション、環境変数のトークンを使用する場合は不要）
   */
  @Post('execute')
  async executeOptimization(@Body('accessToken') accessToken?: string) {
    this.logger.log('Budget optimization execution requested');

    try {
      // アクセストークンが指定されていない場合は環境変数から取得
      const token = accessToken || this.configService.get<string>('TIKTOK_ACCESS_TOKEN');

      if (!token) {
        return {
          success: false,
          error: 'Access token is required',
        };
      }

      const result = await this.optimizationService.executeOptimization(token);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      this.logger.error('Failed to execute budget optimization', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 特定Advertiserの予算調整を実行
   * POST /api/optimization/execute/:advertiserId
   * Body: { accessToken?: string }
   */
  @Post('execute/:advertiserId')
  async executeAdvertiserOptimization(
    @Param('advertiserId') advertiserId: string,
    @Body('accessToken') accessToken?: string,
  ) {
    this.logger.log(`Budget optimization execution requested for advertiser: ${advertiserId}`);

    try {
      const token = accessToken || this.configService.get<string>('TIKTOK_ACCESS_TOKEN');

      if (!token) {
        return {
          success: false,
          error: 'Access token is required',
        };
      }

      const result = await this.optimizationService.optimizeAdvertiser(advertiserId, token);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      this.logger.error('Failed to execute budget optimization', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
