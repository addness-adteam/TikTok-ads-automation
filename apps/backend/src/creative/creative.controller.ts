import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
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
   * Creativeアップロード
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
