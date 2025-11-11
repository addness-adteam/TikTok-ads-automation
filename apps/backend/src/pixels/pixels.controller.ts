import {
  Controller,
  Get,
  Query,
  Logger,
} from '@nestjs/common';
import { TiktokService } from '../tiktok/tiktok.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('api/pixels')
export class PixelsController {
  private readonly logger = new Logger(PixelsController.name);

  constructor(
    private readonly tiktokService: TiktokService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Pixel一覧取得
   * GET /api/pixels?advertiserId=xxx
   */
  @Get()
  async getPixels(@Query('advertiserId') advertiserId: string) {
    this.logger.log(`Getting pixels for advertiser: ${advertiserId}`);

    try {
      if (!advertiserId) {
        return {
          success: false,
          error: 'advertiserId is required',
        };
      }

      // AdvertiserのtiktokAdvertiserIdを取得
      const advertiser = await this.prisma.advertiser.findUnique({
        where: { id: advertiserId },
      });

      if (!advertiser) {
        return {
          success: false,
          error: 'Advertiser not found',
        };
      }

      // Access Tokenを取得
      const token = await this.prisma.oAuthToken.findUnique({
        where: { advertiserId: advertiser.tiktokAdvertiserId },
      });

      if (!token) {
        return {
          success: false,
          error: 'Access token not found for this advertiser',
        };
      }

      // TikTok APIからPixel一覧を取得
      const result = await this.tiktokService.getPixels(
        advertiser.tiktokAdvertiserId,
        token.accessToken,
      );

      return {
        success: true,
        data: result.data?.pixels || [],
      };
    } catch (error) {
      this.logger.error('Failed to get pixels');
      this.logger.error(`Error message: ${error.message}`);
      this.logger.error(`Error stack: ${error.stack}`);
      return {
        success: false,
        error: error.message || 'Failed to fetch pixels',
      };
    }
  }
}
