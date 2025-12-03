import { Controller, Get, Query, Param } from '@nestjs/common';
import { AdPerformanceService } from './ad-performance.service';

@Controller('ad-performances')
export class AdPerformanceController {
  constructor(private readonly adPerformanceService: AdPerformanceService) {}

  /**
   * 広告パフォーマンス一覧取得
   * GET /api/ad-performances?advertiserId=xxx&impressionThresholdMet=true&hasDeviation=true
   */
  @Get()
  async getAdPerformances(
    @Query('advertiserId') advertiserId: string,
    @Query('impressionThresholdMet') impressionThresholdMet?: string,
    @Query('hasDeviation') hasDeviation?: string,
  ) {
    return this.adPerformanceService.getAdPerformances(advertiserId, {
      impressionThresholdMet:
        impressionThresholdMet !== undefined
          ? impressionThresholdMet === 'true'
          : undefined,
      hasDeviation:
        hasDeviation !== undefined ? hasDeviation === 'true' : undefined,
    });
  }

  /**
   * 広告パフォーマンス詳細取得
   * GET /api/ad-performances/:adId
   */
  @Get(':adId')
  async getAdPerformanceDetail(@Param('adId') adId: string) {
    return this.adPerformanceService.getAdPerformanceDetail(adId);
  }
}
