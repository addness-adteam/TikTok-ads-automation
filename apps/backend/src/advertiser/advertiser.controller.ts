import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Logger,
} from '@nestjs/common';
import { AdvertiserService } from './advertiser.service';

@Controller('api/advertisers')
export class AdvertiserController {
  private readonly logger = new Logger(AdvertiserController.name);

  constructor(private readonly advertiserService: AdvertiserService) {}

  /**
   * Advertiser一覧取得
   * GET /api/advertisers
   */
  @Get()
  async findAll() {
    this.logger.log('Getting all advertisers');

    try {
      const advertisers = await this.advertiserService.findAll();
      return {
        success: true,
        data: advertisers,
      };
    } catch (error) {
      this.logger.error('Failed to get advertisers');
      this.logger.error(`Error message: ${error.message}`);
      this.logger.error(`Error stack: ${error.stack}`);
      return {
        success: false,
        error: error.message || 'Failed to fetch advertisers',
      };
    }
  }

  /**
   * Advertiserに紐づく広告一覧取得
   * GET /api/advertisers/:advertiserId/ads
   */
  @Get(':advertiserId/ads')
  async findAds(@Param('advertiserId') advertiserId: string) {
    this.logger.log(`Getting ads for advertiser: ${advertiserId}`);

    try {
      const ads = await this.advertiserService.findAdsByAdvertiserId(advertiserId);
      return {
        success: true,
        data: ads,
      };
    } catch (error) {
      this.logger.error('Failed to get ads for advertiser');
      this.logger.error(`Error message: ${error.message}`);
      this.logger.error(`Error stack: ${error.stack}`);
      return {
        success: false,
        error: error.message || 'Failed to fetch ads',
        data: [],
      };
    }
  }

  /**
   * Advertiser取得
   * GET /api/advertisers/:id
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    this.logger.log(`Getting advertiser: ${id}`);

    try {
      const advertiser = await this.advertiserService.findOne(id);
      return {
        success: true,
        data: advertiser,
      };
    } catch (error) {
      this.logger.error('Failed to get advertiser');
      this.logger.error(`Error message: ${error.message}`);
      this.logger.error(`Error stack: ${error.stack}`);
      return {
        success: false,
        error: error.message || 'Failed to fetch advertiser',
      };
    }
  }

  /**
   * Advertiserに訴求を紐付け
   * PATCH /api/advertisers/:id/appeal
   * Body: { appealId: string | null }
   */
  @Patch(':id/appeal')
  async assignAppeal(
    @Param('id') id: string,
    @Body('appealId') appealId: string | null,
  ) {
    this.logger.log(`Assigning appeal ${appealId} to advertiser ${id}`);

    try {
      const advertiser = await this.advertiserService.assignAppeal(id, appealId);
      return {
        success: true,
        data: advertiser,
      };
    } catch (error) {
      this.logger.error('Failed to assign appeal to advertiser');
      this.logger.error(`Error message: ${error.message}`);
      this.logger.error(`Error stack: ${error.stack}`);
      return {
        success: false,
        error: error.message || 'Failed to assign appeal',
      };
    }
  }
}
