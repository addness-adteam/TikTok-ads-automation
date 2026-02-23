import { Controller, Get, Query } from '@nestjs/common';
import { CreatorStopRateService } from './creator-stop-rate.service';

@Controller('api/creator-stop-rate')
export class CreatorStopRateController {
  constructor(
    private readonly creatorStopRateService: CreatorStopRateService,
  ) {}

  /**
   * CR制作者ごとの広告停止率取得
   * GET /api/creator-stop-rate?advertiserIds=xxx,yyy&days=30
   */
  @Get()
  async getCreatorStopRates(
    @Query('advertiserIds') advertiserIds?: string,
    @Query('days') days?: string,
  ) {
    return this.creatorStopRateService.getCreatorStopRates({
      advertiserIds: advertiserIds
        ? advertiserIds.split(',').map((id) => id.trim())
        : undefined,
      days: days ? parseInt(days, 10) : undefined,
    });
  }
}
