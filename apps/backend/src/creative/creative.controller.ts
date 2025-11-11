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
   * Vercel Blob Client Upload用のトークン取得
   * GET /api/creatives/blob-token
   */
  @Get('blob-token')
  async getBlobUploadToken() {
    this.logger.log(`Getting Blob upload token`);

    try {
      const blobToken = this.configService.get<string>('BLOB_READ_WRITE_TOKEN');

      if (!blobToken) {
        throw new BadRequestException('BLOB_READ_WRITE_TOKEN is not configured');
      }

      return {
        success: true,
        data: {
          token: blobToken,
        },
      };
    } catch (error) {
      this.logger.error('Failed to get blob upload token', error);
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
   * Vercel BlobからTikTok APIへアップロード
   * POST /api/creatives/upload-from-blob
   * Body (JSON):
   *   - advertiserId: Advertiser ID (UUID)
   *   - name: Creative名
   *   - blobUrl: Vercel BlobのURL
   *   - filename: ファイル名
   *   - fileSize: ファイルサイズ
   */
  @Post('upload-from-blob')
  async uploadFromBlob(
    @Body('advertiserId') advertiserId: string,
    @Body('name') name: string,
    @Body('blobUrl') blobUrl: string,
    @Body('filename') filename: string,
    @Body('fileSize') fileSize: number,
  ) {
    this.logger.log(`Uploading creative from Blob for advertiser: ${advertiserId}`);

    try {
      if (!advertiserId || !name || !blobUrl || !filename) {
        throw new BadRequestException('advertiserId, name, blobUrl, and filename are required');
      }

      const creative = await this.creativeService.uploadFromBlob(
        advertiserId,
        name,
        blobUrl,
        filename,
        fileSize,
      );

      return {
        success: true,
        data: creative,
      };
    } catch (error) {
      this.logger.error('Failed to upload creative from Blob', error);
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
