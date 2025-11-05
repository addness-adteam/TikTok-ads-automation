import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { put } from '@vercel/blob';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class CreativeService {
  private readonly logger = new Logger(CreativeService.name);
  private readonly tiktokApiBaseUrl: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.tiktokApiBaseUrl = this.configService.get<string>('TIKTOK_API_BASE_URL') || '';
  }

  /**
   * 動画/画像をアップロード
   */
  async uploadCreative(
    advertiserId: string,
    name: string,
    file: Express.Multer.File,
    accessToken: string,
  ) {
    this.logger.log(`Uploading creative for advertiser: ${advertiserId}`);

    try {
      // ファイルタイプを判定
      const isVideo = file.mimetype.startsWith('video/');
      const isImage = file.mimetype.startsWith('image/');

      if (!isVideo && !isImage) {
        throw new BadRequestException('Only video and image files are supported');
      }

      // Vercel Blob Storageにアップロード
      const blob = await put(file.originalname, file.buffer, {
        access: 'public',
        token: this.configService.get<string>('BLOB_READ_WRITE_TOKEN'),
      });

      this.logger.log(`File uploaded to Blob Storage: ${blob.url}`);

      // TikTok APIにアップロード
      let tiktokId: string | null = null;
      if (isVideo) {
        tiktokId = await this.uploadVideoToTikTok(advertiserId, blob.url, accessToken);
      } else {
        tiktokId = await this.uploadImageToTikTok(advertiserId, blob.url, accessToken);
      }

      // DBに保存
      const creative = await this.prisma.creative.create({
        data: {
          advertiserId,
          name,
          tiktokVideoId: isVideo ? tiktokId : null,
          tiktokImageId: isImage ? tiktokId : null,
          type: isVideo ? 'VIDEO' : 'IMAGE',
          url: blob.url,
          filename: file.originalname,
          fileSize: file.size,
          width: null, // 後でメタデータから取得
          height: null,
          duration: null,
          status: 'UPLOADED',
        },
      });

      this.logger.log(`Creative saved to database: ${creative.id}`);

      return creative;
    } catch (error) {
      this.logger.error('Failed to upload creative', error);
      throw error;
    }
  }

  /**
   * TikTok APIに動画をアップロード
   */
  private async uploadVideoToTikTok(
    advertiserId: string,
    videoUrl: string,
    accessToken: string,
  ): Promise<string> {
    this.logger.log(`Uploading video to TikTok: ${videoUrl}`);

    try {
      const response = await axios.post(
        `${this.tiktokApiBaseUrl}/v1.3/file/video/ad/upload/`,
        {
          advertiser_id: advertiserId,
          video_url: videoUrl,
          upload_type: 'UPLOAD_BY_URL',
        },
        {
          headers: {
            'Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        },
      );

      const videoId = response.data.data?.video_id;
      if (!videoId) {
        throw new Error('Failed to get video_id from TikTok API');
      }

      this.logger.log(`Video uploaded to TikTok: ${videoId}`);
      return videoId;
    } catch (error) {
      this.logger.error('Failed to upload video to TikTok', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * TikTok APIに画像をアップロード
   */
  private async uploadImageToTikTok(
    advertiserId: string,
    imageUrl: string,
    accessToken: string,
  ): Promise<string> {
    this.logger.log(`Uploading image to TikTok: ${imageUrl}`);

    try {
      const response = await axios.post(
        `${this.tiktokApiBaseUrl}/v1.3/file/image/ad/upload/`,
        {
          advertiser_id: advertiserId,
          image_url: imageUrl,
          upload_type: 'UPLOAD_BY_URL',
        },
        {
          headers: {
            'Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        },
      );

      const imageId = response.data.data?.image_id;
      if (!imageId) {
        throw new Error('Failed to get image_id from TikTok API');
      }

      this.logger.log(`Image uploaded to TikTok: ${imageId}`);
      return imageId;
    } catch (error) {
      this.logger.error('Failed to upload image to TikTok', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Creative一覧取得
   */
  async findAll() {
    return this.prisma.creative.findMany({
      include: {
        advertiser: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Creative取得（ID指定）
   */
  async findOne(id: string) {
    return this.prisma.creative.findUnique({
      where: { id },
    });
  }

  /**
   * Creative削除
   */
  async remove(id: string) {
    return this.prisma.creative.delete({
      where: { id },
    });
  }
}
