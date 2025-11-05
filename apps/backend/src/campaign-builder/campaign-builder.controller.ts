import { Controller, Post, Body, Logger } from '@nestjs/common';
import { CampaignBuilderService, CampaignBuilderInput } from './campaign-builder.service';
import { ConfigService } from '@nestjs/config';

@Controller('api/campaign-builder')
export class CampaignBuilderController {
  private readonly logger = new Logger(CampaignBuilderController.name);

  constructor(
    private readonly campaignBuilderService: CampaignBuilderService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Campaign自動作成（ノンタゲ・類似パターン）
   * POST /api/campaign-builder/create
   */
  @Post('create')
  async createCampaign(
    @Body() input: CampaignBuilderInput & { accessToken?: string },
  ) {
    this.logger.log(`Campaign creation requested: ${input.campaignName}, pattern: ${input.pattern}`);

    try {
      const token = input.accessToken || this.configService.get<string>('TIKTOK_ACCESS_TOKEN');

      if (!token) {
        return {
          success: false,
          error: 'Access token is required',
        };
      }

      const result = await this.campaignBuilderService.buildCampaign(input, token);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      this.logger.error('Failed to create campaign', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
