import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  Body,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreativeService } from './creative.service';
import { ConfigService } from '@nestjs/config';

@Controller('api/creatives')
export class CreativeController {
  private readonly logger = new Logger(CreativeController.name);

  constructor(
    private readonly creativeService: CreativeService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Access Token取得（フロントエンドから直接TikTokにアップロードする用）
   * GET /api/creatives/upload-token?advertiserId=xxx
   */
  @Get('upload-token')
  async getUploadToken(@Query('advertiserId') advertiserId: string) {
    this.logger.log(`Getting upload token for advertiser: ${advertiserId}`);

    try {
      if (!advertiserId) {
        throw new BadRequestException('advertiserId is required');
      }

      // Advertiserを取得
      const advertiser = await this.creativeService.getAdvertiser(advertiserId);

      if (!advertiser) {
        throw new BadRequestException('Advertiser not found');
      }

      // Access Tokenを取得
      const token = await this.creativeService.getAccessToken(advertiser.tiktokAdvertiserId);

      if (!token) {
        throw new BadRequestException('Access token not found for this advertiser');
      }

      return {
        success: true,
        data: {
          accessToken: token,
          tiktokAdvertiserId: advertiser.tiktokAdvertiserId,
          apiBaseUrl: this.configService.get<string>('TIKTOK_API_BASE_URL'),
        },
      };
    } catch (error) {
      this.logger.error('Failed to get upload token', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Creative一覧取得
   * GET /api/creatives?advertiserId=xxx
   */
  @Get()
  async findAll() {
    this.logger.log('Getting all creatives');

    try {
      const creatives = await this.creativeService.findAll();
      return {
        success: true,
        data: creatives,
      };
    } catch (error) {
      this.logger.error('Failed to get creatives', error);
      return {
        success: false,
        error: error.message || 'Failed to fetch creatives',
      };
    }
  }

  /**
   * Creative取得
   * GET /api/creatives/:id
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    this.logger.log(`Getting creative: ${id}`);

    try {
      const creative = await this.creativeService.findOne(id);
      return {
        success: true,
        data: creative,
      };
    } catch (error) {
      this.logger.error('Failed to get creative', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Creative情報をDB登録（TikTokへのアップロード後）
   * POST /api/creatives/register
   * Body (JSON):
   *   - advertiserId: Advertiser ID (UUID)
   *   - name: Creative名
   *   - type: 'VIDEO' | 'IMAGE'
   *   - tiktokVideoId?: TikTok Video ID
   *   - tiktokImageId?: TikTok Image ID
   *   - fileUrl?: File URL
   *   - filename: ファイル名
   *   - fileSize?: ファイルサイズ
   */
  @Post('register')
  async register(
    @Body('advertiserId') advertiserId: string,
    @Body('name') name: string,
    @Body('type') type: 'VIDEO' | 'IMAGE',
    @Body('tiktokVideoId') tiktokVideoId?: string,
    @Body('tiktokImageId') tiktokImageId?: string,
    @Body('fileUrl') fileUrl?: string,
    @Body('filename') filename?: string,
    @Body('fileSize') fileSize?: number,
  ) {
    this.logger.log(`Registering creative for advertiser: ${advertiserId}`);

    try {
      if (!advertiserId || !name || !type) {
        throw new BadRequestException('advertiserId, name, and type are required');
      }

      const creative = await this.creativeService.registerCreative({
        advertiserId,
        name,
        type,
        tiktokVideoId,
        tiktokImageId,
        fileUrl,
        filename: filename || 'unknown',
        fileSize,
      });

      return {
        success: true,
        data: creative,
      };
    } catch (error) {
      this.logger.error('Failed to register creative', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Creativeアップロード（レガシー - Vercel制限あり）
   * POST /api/creatives/upload
   * Body (multipart/form-data):
   *   - file: 動画/画像ファイル
   *   - advertiserId: Advertiser ID
   *   - name: Creative名
   *   - accessToken: Access Token（オプション）
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('advertiserId') advertiserId: string,
    @Body('name') name: string,
    @Body('accessToken') accessToken?: string,
  ) {
    this.logger.log(`Uploading creative for advertiser: ${advertiserId}`);

    if (!file) {
      throw new BadRequestException('File is required');
    }

    if (!advertiserId) {
      throw new BadRequestException('advertiserId is required');
    }

    if (!name) {
      throw new BadRequestException('name is required');
    }

    try {
      const token = accessToken || this.configService.get<string>('TIKTOK_ACCESS_TOKEN');

      if (!token) {
        throw new BadRequestException('Access token is required');
      }

      const creative = await this.creativeService.uploadCreative(advertiserId, name, file, token);

      return {
        success: true,
        data: creative,
      };
    } catch (error) {
      this.logger.error('Failed to upload creative', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Creative削除
   * DELETE /api/creatives/:id
   */
  @Delete(':id')
  async remove(@Param('id') id: string) {
    this.logger.log(`Deleting creative: ${id}`);

    try {
      await this.creativeService.remove(id);
      return {
        success: true,
        message: 'Creative deleted successfully',
      };
    } catch (error) {
      this.logger.error('Failed to delete creative', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
