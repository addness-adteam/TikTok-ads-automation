import { Controller, Get, Post, Put, Delete, Body, Param, Logger } from '@nestjs/common';
import { AdTextTemplateService, CreateAdTextTemplateDto, UpdateAdTextTemplateDto } from './ad-text-template.service';

@Controller('api')
export class AdTextTemplateController {
  private readonly logger = new Logger(AdTextTemplateController.name);

  constructor(private readonly adTextTemplateService: AdTextTemplateService) {}

  /**
   * 訴求IDで広告文テンプレート一覧取得
   * GET /api/appeals/:appealId/ad-text-templates
   */
  @Get('appeals/:appealId/ad-text-templates')
  async getTemplatesByAppeal(@Param('appealId') appealId: string) {
    try {
      const templates = await this.adTextTemplateService.findByAppealId(appealId);
      return {
        success: true,
        data: templates,
      };
    } catch (error) {
      this.logger.error(`Failed to get ad text templates: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 広告文テンプレート作成
   * POST /api/appeals/:appealId/ad-text-templates
   */
  @Post('appeals/:appealId/ad-text-templates')
  async createTemplate(
    @Param('appealId') appealId: string,
    @Body() body: { name: string; text: string },
  ) {
    try {
      const dto: CreateAdTextTemplateDto = {
        appealId,
        name: body.name,
        text: body.text,
      };

      const template = await this.adTextTemplateService.create(dto);
      return {
        success: true,
        data: template,
      };
    } catch (error) {
      this.logger.error(`Failed to create ad text template: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 広告文テンプレート更新
   * PUT /api/ad-text-templates/:id
   */
  @Put('ad-text-templates/:id')
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateAdTextTemplateDto,
  ) {
    try {
      const template = await this.adTextTemplateService.update(id, dto);
      return {
        success: true,
        data: template,
      };
    } catch (error) {
      this.logger.error(`Failed to update ad text template: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 広告文テンプレート削除
   * DELETE /api/ad-text-templates/:id
   */
  @Delete('ad-text-templates/:id')
  async deleteTemplate(@Param('id') id: string) {
    try {
      await this.adTextTemplateService.delete(id);
      return {
        success: true,
      };
    } catch (error) {
      this.logger.error(`Failed to delete ad text template: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
