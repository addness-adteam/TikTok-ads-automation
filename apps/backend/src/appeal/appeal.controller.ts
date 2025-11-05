import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Logger,
} from '@nestjs/common';
import { AppealService } from './appeal.service';
import type { CreateAppealDto, UpdateAppealDto } from './appeal.service';

@Controller('api/appeals')
export class AppealController {
  private readonly logger = new Logger(AppealController.name);

  constructor(private readonly appealService: AppealService) {}

  /**
   * 訴求マスタ一覧取得
   * GET /api/appeals
   */
  @Get()
  async findAll() {
    this.logger.log('Getting all appeals');

    try {
      const appeals = await this.appealService.findAll();
      return appeals;
    } catch (error) {
      this.logger.error('Failed to get appeals', error);
      throw error;
    }
  }

  /**
   * 訴求マスタ取得
   * GET /api/appeals/:id
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    this.logger.log(`Getting appeal: ${id}`);

    try {
      const appeal = await this.appealService.findOne(id);
      return {
        success: true,
        data: appeal,
      };
    } catch (error) {
      this.logger.error('Failed to get appeal', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 訴求マスタ作成
   * POST /api/appeals
   * Body: { name, targetCPA, allowableCPA, targetFrontCPO, allowableFrontCPO, cvSpreadsheetUrl, frontSpreadsheetUrl }
   */
  @Post()
  async create(@Body() data: CreateAppealDto) {
    this.logger.log(`Creating appeal: ${data.name}`);

    try {
      const appeal = await this.appealService.create(data);
      return {
        success: true,
        data: appeal,
      };
    } catch (error) {
      this.logger.error('Failed to create appeal', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 訴求マスタ更新
   * PATCH /api/appeals/:id
   * Body: { name?, targetCPA?, allowableCPA?, targetFrontCPO?, allowableFrontCPO?, cvSpreadsheetUrl?, frontSpreadsheetUrl? }
   */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: UpdateAppealDto) {
    this.logger.log(`Updating appeal: ${id}`);

    try {
      const appeal = await this.appealService.update(id, data);
      return {
        success: true,
        data: appeal,
      };
    } catch (error) {
      this.logger.error('Failed to update appeal', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 訴求マスタ削除
   * DELETE /api/appeals/:id
   */
  @Delete(':id')
  async remove(@Param('id') id: string) {
    this.logger.log(`Deleting appeal: ${id}`);

    try {
      await this.appealService.remove(id);
      return {
        success: true,
        message: 'Appeal deleted successfully',
      };
    } catch (error) {
      this.logger.error('Failed to delete appeal', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Advertiserに訴求を紐付け
   * POST /api/appeals/:appealId/assign/:advertiserId
   */
  @Post(':appealId/assign/:advertiserId')
  async assignToAdvertiser(
    @Param('appealId') appealId: string,
    @Param('advertiserId') advertiserId: string,
  ) {
    this.logger.log(`Assigning appeal ${appealId} to advertiser ${advertiserId}`);

    try {
      const advertiser = await this.appealService.assignToAdvertiser(appealId, advertiserId);
      return {
        success: true,
        data: advertiser,
      };
    } catch (error) {
      this.logger.error('Failed to assign appeal to advertiser', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
