import { Controller, Post, Body, Logger } from '@nestjs/common';
import { CampaignBuilderService, CampaignBuilderInput } from './campaign-builder.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * フロントエンドから受け取るデータ形式
 */
interface FrontendCampaignInput {
  advertiserId: string; // DB UUID
  campaignName: string;
  pattern: 'NON_TARGETING' | 'LOOKALIKE';
  adTexts: string[];
  landingPageUrl: string;
  lpName: string;
  creativeIds: string[];
  pixelId: string;
  dailyBudget: number;
  accessToken?: string;
}

@Controller('api/campaign-builder')
export class CampaignBuilderController {
  private readonly logger = new Logger(CampaignBuilderController.name);

  constructor(
    private readonly campaignBuilderService: CampaignBuilderService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Campaign自動作成（ノンタゲ・類似パターン）
   * POST /api/campaign-builder/create
   */
  @Post('create')
  async createCampaign(@Body() frontendInput: FrontendCampaignInput) {
    this.logger.log(`Campaign creation requested: ${frontendInput.campaignName}, pattern: ${frontendInput.pattern}`);

    try {
      const token = frontendInput.accessToken || this.configService.get<string>('TIKTOK_ACCESS_TOKEN');

      if (!token) {
        return {
          success: false,
          error: 'Access token is required',
        };
      }

      // 1. AdvertiserのtiktokAdvertiserIdを取得
      const advertiser = await this.prisma.advertiser.findUnique({
        where: { id: frontendInput.advertiserId },
        include: { appeal: true },
      });

      if (!advertiser) {
        return {
          success: false,
          error: 'Advertiser not found',
        };
      }

      // 2. フロントエンドのデータをバックエンド形式に変換
      const ads = frontendInput.adTexts.map((adText, index) => {
        // 各広告文とCreativeを組み合わせて広告を作成
        const creativeId = frontendInput.creativeIds[index % frontendInput.creativeIds.length];

        return {
          adName: `${frontendInput.lpName}_${index + 1}`,
          creativeId,
          landingPageUrl: `${frontendInput.landingPageUrl}?registration_route=TikTok広告-${advertiser.appeal?.name || '訴求'}-${frontendInput.lpName}`,
        };
      });

      const backendInput: CampaignBuilderInput = {
        advertiserId: advertiser.tiktokAdvertiserId, // TikTok Advertiser ID
        campaignName: frontendInput.campaignName,
        pixelId: frontendInput.pixelId,
        optimizationEvent: 'ON_WEB_REGISTER', // 固定: ウェブサイト登録完了
        dailyBudget: frontendInput.dailyBudget,
        pattern: frontendInput.pattern,
        ads,
      };

      this.logger.log(`Converted backend input: ${JSON.stringify(backendInput, null, 2)}`);

      // 3. キャンペーンを作成
      const result = await this.campaignBuilderService.buildCampaign(backendInput, token);

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
