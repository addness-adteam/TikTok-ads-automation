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
      let tiktokVideoId: string | null = null;
      let tiktokImageId: string | null = null;
      let thumbnailImageId: string | null = null;

      if (isVideo) {
        // 動画アップロード
        const videoResult = await this.uploadVideoToTikTok(tiktokAdvertiserId, file, accessToken);
        tiktokVideoId = videoResult.videoId;

        // 動画のカバー画像を取得してサムネイル用の画像IDを作成
        if (videoResult.videoCoverUrl) {
          this.logger.log(`Uploading video thumbnail from cover URL: ${videoResult.videoCoverUrl}`);
          thumbnailImageId = await this.uploadImageToTikTok(
            tiktokAdvertiserId,
            videoResult.videoCoverUrl,
            accessToken
          );
          this.logger.log(`Thumbnail image uploaded: ${thumbnailImageId}`);
        }
      } else {
        // 画像アップロード
        tiktokImageId = await this.uploadImageToTikTok(tiktokAdvertiserId, blob.url, accessToken);
      }

      // DBに保存
      const creative = await this.prisma.creative.create({
        data: {
          advertiserId,
          name,
          tiktokVideoId: isVideo ? tiktokVideoId : null,
          tiktokImageId: isImage ? tiktokImageId : thumbnailImageId, // 動画の場合はサムネイル画像IDを保存
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
  ): Promise<{ videoId: string; videoCoverUrl?: string }> {
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
      const videoData = Array.isArray(response.data.data)
        ? response.data.data[0]
        : response.data.data;

      if (!videoData?.video_id) {
        this.logger.error(`Response data structure: ${JSON.stringify(response.data)}`);
        throw new Error('Failed to get video_id from TikTok API');
      }

      this.logger.log(`Video uploaded to TikTok: ${videoData.video_id}`);

      // 動画のカバー画像URLを取得するため、動画情報をクエリ
      // TikTokは動画処理に時間がかかるため、リトライロジックを実装
      let videoCoverUrl: string | undefined;
      try {
        const maxRetries = 5;
        const initialDelay = 3000; // 3秒
        let videoInfo: any = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          // 指数バックオフで待機時間を増やす
          const delayMs = initialDelay * Math.pow(1.5, attempt - 1);
          this.logger.log(`Waiting ${delayMs}ms before querying video info (attempt ${attempt}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));

          const videoInfoResponse = await axios.get(
            `${this.tiktokApiBaseUrl}/v1.3/file/video/ad/info/`,
            {
              params: {
                advertiser_id: advertiserId,
                video_ids: JSON.stringify([videoData.video_id]),
              },
              headers: {
                'Access-Token': accessToken,
              },
            },
          );

          this.logger.log(`Video info API response (attempt ${attempt}): ${JSON.stringify(videoInfoResponse.data)}`);

          // TikTokが動画を処理完了している場合、listは空ではない
          if (videoInfoResponse.data.data?.list && videoInfoResponse.data.data.list.length > 0) {
            videoInfo = videoInfoResponse.data.data.list[0];
            this.logger.log(`Video info retrieved successfully on attempt ${attempt}: ${JSON.stringify(videoInfo)}`);
            break;
          } else {
            this.logger.log(`Video not ready yet (attempt ${attempt}/${maxRetries}), list is empty`);
          }
        }

        if (videoInfo) {
          // TikTok APIは poster_url または cover_image_uri を返す
          videoCoverUrl = videoInfo.poster_url || videoInfo.cover_image_uri || videoInfo.video_cover_url;
          this.logger.log(`Video cover URL retrieved: ${videoCoverUrl || 'Not available'}`);
        } else {
          this.logger.warn(`Video info not available after ${maxRetries} retries, will proceed without thumbnail`);
        }
      } catch (infoError) {
        this.logger.warn('Failed to get video cover URL, will proceed without thumbnail', infoError.message);
      }

      return {
        videoId: videoData.video_id,
        videoCoverUrl,
      };
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

  /**
   * Advertiser情報取得
   */
  async getAdvertiser(advertiserId: string) {
    return this.prisma.advertiser.findUnique({
      where: { id: advertiserId },
    });
  }

  /**
   * Access Token取得
   */
  async getAccessToken(tiktokAdvertiserId: string): Promise<string | null> {
    const token = await this.prisma.oAuthToken.findUnique({
      where: { advertiserId: tiktokAdvertiserId },
    });
    return token?.accessToken || null;
  }

  /**
   * Creative情報をDBに登録（TikTokアップロード後）
   */
  async registerCreative(data: {
    advertiserId: string;
    name: string;
    type: 'VIDEO' | 'IMAGE';
    tiktokVideoId?: string;
    tiktokImageId?: string;
    fileUrl?: string;
    filename: string;
    fileSize?: number;
  }) {
    this.logger.log(`Registering creative: ${data.name}`);

    return this.prisma.creative.create({
      data: {
        advertiserId: data.advertiserId,
        name: data.name,
        tiktokVideoId: data.tiktokVideoId || null,
        tiktokImageId: data.tiktokImageId || null,
        type: data.type,
        url: data.fileUrl || '',
        filename: data.filename,
        fileSize: data.fileSize || null,
        status: 'UPLOADED',
      },
    });
  }

  /**
   * Vercel BlobからファイルをダウンロードしてTikTok APIにアップロード
   */
  async uploadFromBlob(
    advertiserId: string,
    name: string,
    blobUrl: string,
    filename: string,
    fileSize: number,
  ) {
    this.logger.log(`Uploading creative from Blob: ${blobUrl}`);

    try {
      // Advertiserテーブルから TikTok Advertiser ID を取得
      const advertiser = await this.prisma.advertiser.findUnique({
        where: { id: advertiserId },
      });

      if (!advertiser) {
        throw new BadRequestException('Advertiser not found');
      }

      const tiktokAdvertiserId = advertiser.tiktokAdvertiserId;

      // Access Tokenを取得
      const accessToken = await this.getAccessToken(tiktokAdvertiserId);
      if (!accessToken) {
        throw new BadRequestException('Access token not found for this advertiser');
      }

      // Vercel Blobからファイルをダウンロード
      this.logger.log(`Downloading file from Blob: ${blobUrl}`);
      const response = await axios.get(blobUrl, {
        responseType: 'arraybuffer',
      });

      const fileBuffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'] || 'application/octet-stream';

      this.logger.log(`Downloaded file: ${fileBuffer.length} bytes, type: ${contentType}`);

      // ファイルタイプを判定
      const isVideo = contentType.startsWith('video/');
      const isImage = contentType.startsWith('image/');

      if (!isVideo && !isImage) {
        throw new BadRequestException('Only video and image files are supported');
      }

      // TikTok APIにアップロード
      let tiktokVideoId: string | null = null;
      let tiktokImageId: string | null = null;
      let thumbnailImageId: string | null = null;

      if (isVideo) {
        // 動画アップロード
        const videoResult = await this.uploadVideoToTikTokFromBuffer(
          tiktokAdvertiserId,
          fileBuffer,
          filename,
          contentType,
          accessToken,
        );
        tiktokVideoId = videoResult.videoId;

        // 動画のカバー画像を取得してサムネイル用の画像IDを作成
        if (videoResult.videoCoverUrl) {
          this.logger.log(`Uploading video thumbnail from cover URL: ${videoResult.videoCoverUrl}`);
          thumbnailImageId = await this.uploadImageToTikTok(
            tiktokAdvertiserId,
            videoResult.videoCoverUrl,
            accessToken,
          );
          this.logger.log(`Thumbnail image uploaded: ${thumbnailImageId}`);
        }
      } else {
        // 画像アップロード
        tiktokImageId = await this.uploadImageToTikTok(tiktokAdvertiserId, blobUrl, accessToken);
      }

      // DBに保存
      const creative = await this.prisma.creative.create({
        data: {
          advertiserId,
          name,
          tiktokVideoId: isVideo ? tiktokVideoId : null,
          tiktokImageId: isImage ? tiktokImageId : thumbnailImageId,
          type: isVideo ? 'VIDEO' : 'IMAGE',
          url: blobUrl,
          filename,
          fileSize,
          width: null,
          height: null,
          duration: null,
          status: 'UPLOADED',
        },
      });

      this.logger.log(`Creative saved to database: ${creative.id}`);

      return creative;
    } catch (error) {
      this.logger.error('Failed to upload creative from Blob', error);
      throw error;
    }
  }

  /**
   * TikTok APIに動画をアップロード（Bufferから）
   */
  private async uploadVideoToTikTokFromBuffer(
    advertiserId: string,
    fileBuffer: Buffer,
    filename: string,
    contentType: string,
    accessToken: string,
  ): Promise<{ videoId: string; videoCoverUrl?: string }> {
    this.logger.log(`Uploading video to TikTok: ${filename} (${fileBuffer.length} bytes)`);

    try {
      // Calculate MD5 hash of the video file
      const md5Hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
      this.logger.log(`Video MD5 signature: ${md5Hash}`);

      // 日本語ファイル名の文字化けを防ぐため、英数字のファイル名を生成
      const ext = filename.split('.').pop() || 'mp4';
      const sanitizedFilename = `video_${Date.now()}_${md5Hash.substring(0, 8)}.${ext}`;

      const formData = new FormData();
      formData.append('advertiser_id', advertiserId);
      formData.append('upload_type', 'UPLOAD_BY_FILE');
      formData.append('video_signature', md5Hash);
      formData.append('video_file', fileBuffer, {
        filename: sanitizedFilename,
        contentType: contentType,
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
      const videoData = Array.isArray(response.data.data)
        ? response.data.data[0]
        : response.data.data;

      if (!videoData?.video_id) {
        this.logger.error(`Response data structure: ${JSON.stringify(response.data)}`);
        throw new Error('Failed to get video_id from TikTok API');
      }

      this.logger.log(`Video uploaded to TikTok: ${videoData.video_id}`);

      // 動画のカバー画像URLを取得するため、動画情報をクエリ
      // TikTokは動画処理に時間がかかるため、リトライロジックを実装
      let videoCoverUrl: string | undefined;
      try {
        const maxRetries = 5;
        const initialDelay = 3000; // 3秒
        let videoInfo: any = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          // 指数バックオフで待機時間を増やす
          const delayMs = initialDelay * Math.pow(1.5, attempt - 1);
          this.logger.log(`Waiting ${delayMs}ms before querying video info (attempt ${attempt}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));

          const videoInfoResponse = await axios.get(
            `${this.tiktokApiBaseUrl}/v1.3/file/video/ad/info/`,
            {
              params: {
                advertiser_id: advertiserId,
                video_ids: JSON.stringify([videoData.video_id]),
              },
              headers: {
                'Access-Token': accessToken,
              },
            },
          );

          this.logger.log(`Video info API response (attempt ${attempt}): ${JSON.stringify(videoInfoResponse.data)}`);

          // TikTokが動画を処理完了している場合、listは空ではない
          if (videoInfoResponse.data.data?.list && videoInfoResponse.data.data.list.length > 0) {
            videoInfo = videoInfoResponse.data.data.list[0];
            this.logger.log(`Video info retrieved successfully on attempt ${attempt}: ${JSON.stringify(videoInfo)}`);
            break;
          } else {
            this.logger.log(`Video not ready yet (attempt ${attempt}/${maxRetries}), list is empty`);
          }
        }

        if (videoInfo) {
          // TikTok APIは poster_url または cover_image_uri を返す
          videoCoverUrl = videoInfo.poster_url || videoInfo.cover_image_uri || videoInfo.video_cover_url;
          this.logger.log(`Video cover URL retrieved: ${videoCoverUrl || 'Not available'}`);
        } else {
          this.logger.warn(`Video info not available after ${maxRetries} retries, will proceed without thumbnail`);
        }
      } catch (infoError) {
        this.logger.warn('Failed to get video cover URL, will proceed without thumbnail', infoError.message);
      }

      return {
        videoId: videoData.video_id,
        videoCoverUrl,
      };
    } catch (error) {
      this.logger.error('Failed to upload video to TikTok', error.response?.data || error.message);
      throw error;
    }
  }
}
