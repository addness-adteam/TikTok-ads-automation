import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { put } from '@vercel/blob';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';
import * as crypto from 'crypto';

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
      // Advertiserテーブルから TikTok Advertiser ID を取得
      const advertiser = await this.prisma.advertiser.findUnique({
        where: { id: advertiserId },
      });

      if (!advertiser) {
        throw new BadRequestException('Advertiser not found');
      }

      const tiktokAdvertiserId = advertiser.tiktokAdvertiserId;

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
        addRandomSuffix: true,
      });

      this.logger.log(`File uploaded to Blob Storage: ${blob.url}`);

      // TikTok APIにアップロード
      let tiktokId: string | null = null;
      if (isVideo) {
        tiktokId = await this.uploadVideoToTikTok(tiktokAdvertiserId, file, accessToken);
      } else {
        tiktokId = await this.uploadImageToTikTok(tiktokAdvertiserId, blob.url, accessToken);
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
    file: Express.Multer.File,
    accessToken: string,
  ): Promise<string> {
    this.logger.log(`Uploading video to TikTok: ${file.originalname} (${file.size} bytes)`);

    try {
      // Calculate MD5 hash of the video file
      const md5Hash = crypto.createHash('md5').update(file.buffer).digest('hex');
      this.logger.log(`Video MD5 signature: ${md5Hash}`);

      // 日本語ファイル名の文字化けを防ぐため、英数字のファイル名を生成
      const ext = file.originalname.split('.').pop() || 'mp4';
      const sanitizedFilename = `video_${Date.now()}_${md5Hash.substring(0, 8)}.${ext}`;

      const formData = new FormData();
      formData.append('advertiser_id', advertiserId);
      formData.append('upload_type', 'UPLOAD_BY_FILE');
      formData.append('video_signature', md5Hash);
      formData.append('video_file', file.buffer, {
        filename: sanitizedFilename,
        contentType: file.mimetype,
      });

      const response = await axios.post(
        `${this.tiktokApiBaseUrl}/v1.3/file/video/ad/upload/`,
        formData,
        {
          headers: {
            'Access-Token': accessToken,
            ...formData.getHeaders(),
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        },
      );

      this.logger.log(`TikTok API Response: ${JSON.stringify(response.data)}`);

      // TikTok API v1.3 returns data as an array
      const videoId = Array.isArray(response.data.data)
        ? response.data.data[0]?.video_id
        : response.data.data?.video_id;

      if (!videoId) {
        this.logger.error(`Response data structure: ${JSON.stringify(response.data)}`);
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

      this.logger.log(`TikTok API Response: ${JSON.stringify(response.data)}`);

      const imageId = response.data.data?.image_id;
      if (!imageId) {
        this.logger.error(`Response data structure: ${JSON.stringify(response.data)}`);
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
