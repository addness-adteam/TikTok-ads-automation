import { Controller, Post, Body, Logger, Param } from '@nestjs/common';
import { OptimizationService, OptimizationMode } from './optimization.service';
import { ConfigService } from '@nestjs/config';

@Controller('api/optimization')
export class OptimizationController {
  private readonly logger = new Logger(OptimizationController.name);

  constructor(
    private readonly optimizationService: OptimizationService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * modeパラメータを検証
   */
  private validateMode(mode?: string): OptimizationMode {
    if (!mode) {
      return 'ROAS_MAXIMIZE'; // デフォルト
    }
    if (mode !== 'ROAS_MAXIMIZE' && mode !== 'ACQUISITION_MAXIMIZE') {
      this.logger.warn(`Invalid mode '${mode}', using default ROAS_MAXIMIZE`);
      return 'ROAS_MAXIMIZE';
    }
    return mode as OptimizationMode;
  }

  /**
   * 予算調整を実行
   * POST /api/optimization/execute
   * Body: { accessToken?: string, mode?: 'ROAS_MAXIMIZE' | 'ACQUISITION_MAXIMIZE' }
   */
  @Post('execute')
  async executeOptimization(
    @Body('accessToken') accessToken?: string,
    @Body('mode') mode?: string,
  ) {
    const validatedMode = this.validateMode(mode);
    this.logger.log(`Budget optimization execution requested (mode: ${validatedMode})`);

    try {
      // アクセストークンが指定されていない場合は環境変数から取得
      const token = accessToken || this.configService.get<string>('TIKTOK_ACCESS_TOKEN');

      if (!token) {
        return {
          success: false,
          error: 'Access token is required',
        };
      }

      const result = await this.optimizationService.executeOptimization(token, validatedMode);

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
   * Body: { accessToken?: string, mode?: 'ROAS_MAXIMIZE' | 'ACQUISITION_MAXIMIZE' }
   */
  @Post('execute/:advertiserId')
  async executeAdvertiserOptimization(
    @Param('advertiserId') advertiserId: string,
    @Body('accessToken') accessToken?: string,
    @Body('mode') mode?: string,
  ) {
    const validatedMode = this.validateMode(mode);
    this.logger.log(`Budget optimization execution requested for advertiser: ${advertiserId} (mode: ${validatedMode})`);

    try {
      const token = accessToken || this.configService.get<string>('TIKTOK_ACCESS_TOKEN');

      if (!token) {
        return {
          success: false,
          error: 'Access token is required',
        };
      }

      const result = await this.optimizationService.optimizeAdvertiser(advertiserId, token, validatedMode);

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
   * 選択した複数Advertiserの予算調整を実行
   * POST /api/optimization/execute-selected
   * Body: { advertiserIds: string[], accessToken?: string, mode?: 'ROAS_MAXIMIZE' | 'ACQUISITION_MAXIMIZE' }
   */
  @Post('execute-selected')
  async executeSelectedAdvertisersOptimization(
    @Body('advertiserIds') advertiserIds: string[],
    @Body('accessToken') accessToken?: string,
    @Body('mode') mode?: string,
  ) {
    const validatedMode = this.validateMode(mode);
    this.logger.log(`Budget optimization execution requested for ${advertiserIds?.length || 0} advertisers (mode: ${validatedMode})`);

    try {
      if (!advertiserIds || advertiserIds.length === 0) {
        return {
          success: false,
          error: 'At least one advertiser ID is required',
        };
      }

      const token = accessToken || this.configService.get<string>('TIKTOK_ACCESS_TOKEN');

      if (!token) {
        return {
          success: false,
          error: 'Access token is required',
        };
      }

      // 各Advertiserに対して順番に最適化を実行
      const results: any[] = [];
      for (const advertiserId of advertiserIds) {
        try {
          this.logger.log(`Executing optimization for advertiser: ${advertiserId}`);
          const result = await this.optimizationService.optimizeAdvertiser(advertiserId, token, validatedMode);
          results.push(result);
        } catch (error) {
          this.logger.error(`Failed to optimize advertiser ${advertiserId}:`, error);
          results.push({
            advertiserId,
            success: false,
            error: error.message,
          });
        }
      }

      // 全体の結果を集計
      const totalResults = {
        mode: validatedMode, // 使用したモードを追加
        totalAdvertisers: advertiserIds.length,
        successCount: results.filter(r => r.success).length,
        failureCount: results.filter(r => !r.success).length,
        totalAds: results.reduce((sum, r) => sum + (r.totalAds || 0), 0),
        evaluated: results.reduce((sum, r) => sum + (r.evaluated || 0), 0),
        decisions: results.reduce((sum, r) => sum + (r.decisions || 0), 0),
        executed: results.reduce((sum, r) => sum + (r.executed || 0), 0),
        results: results,
        // 全ての詳細ログを結合
        detailedLogs: results.flatMap(r => r.detailedLogs || []),
      };

      return {
        success: true,
        data: totalResults,
      };
    } catch (error) {
      this.logger.error('Failed to execute budget optimization for selected advertisers', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 評価期間をデバッグ用に確認
   * POST /api/optimization/debug-period
   */
  @Post('debug-period')
  async debugEvaluationPeriod() {
    return this.optimizationService.debugEvaluationPeriod();
  }
}
