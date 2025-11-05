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
      return advertisers;
    } catch (error) {
      this.logger.error('Failed to get advertisers', error);
      throw error;
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
      return advertiser;
    } catch (error) {
      this.logger.error('Failed to get advertiser', error);
      throw error;
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
      return advertiser;
    } catch (error) {
      this.logger.error('Failed to assign appeal to advertiser', error);
      throw error;
    }
  }
}
