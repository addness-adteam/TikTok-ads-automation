import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import FormData from 'form-data';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  withRetry,
  isTikTokErrorRetryable,
  classifyTikTokError,
  logTikTokError,
  TikTokErrorType,
} from '../common/utils';

/**
 * 日付文字列をUTC 00:00:00の日付に変換するヘルパー関数
 * TikTok APIから返される日付（例: "2025-12-01"）を、タイムゾーンに依存しない形で保存
 * @param dateString "YYYY-MM-DD" 形式の日付文字列
 * @returns UTC 00:00:00 の Date オブジェクト
 */
function parseStatDate(dateString: string): Date {
  // "2025-12-01" → "2025-12-01T00:00:00.000Z" としてパース
  return new Date(dateString + 'T00:00:00.000Z');
}

/**
 * JST基準で「昨日」の日付をUTC 00:00:00形式で取得
 * @returns UTC 00:00:00 の Date オブジェクト（JSTでの昨日の日付）
 */
function getYesterdayJST(): Date {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000; // JST = UTC+9
  const jstNow = new Date(now.getTime() + jstOffset);

  // JSTで昨日を計算
  const yesterdayJST = new Date(jstNow);
  yesterdayJST.setUTCDate(yesterdayJST.getUTCDate() - 1);

  // 日付部分だけ取り出してUTC 00:00:00形式に変換
  const dateString = yesterdayJST.toISOString().split('T')[0];
  return new Date(dateString + 'T00:00:00.000Z');
}

@Injectable()
export class TiktokService {
  private readonly logger = new Logger(TiktokService.name);
  private readonly httpClient: AxiosInstance;
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly baseUrl: string;
  private readonly redirectUri: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.appId = this.configService.get<string>('TIKTOK_APP_ID') || '';
    this.appSecret = this.configService.get<string>('TIKTOK_APP_SECRET') || '';
    this.baseUrl = this.configService.get<string>('TIKTOK_API_BASE_URL') || '';
    this.redirectUri = this.configService.get<string>('TIKTOK_OAUTH_REDIRECT_URI') || '';

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // ============================================================================
  // リトライ対応のHTTPクライアントメソッド
  // 要件定義: リトライ回数3回、間隔1秒→2秒→4秒（指数バックオフ）
  // ============================================================================

  /**
   * リトライ対応のGETリクエスト
   * @param url エンドポイントURL
   * @param config Axiosリクエスト設定
   * @param context ログ出力用のコンテキスト名
   */
  private async httpGetWithRetry<T = any>(
    url: string,
    config?: AxiosRequestConfig,
    context?: string,
  ): Promise<AxiosResponse<T>> {
    return withRetry(
      () => this.httpClient.get<T>(url, config),
      {
        maxRetries: 3,
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        retryableErrors: isTikTokErrorRetryable,
        onRetry: (error, attempt, delayMs) => {
          const errorInfo = classifyTikTokError(error);
          logTikTokError(this.logger, errorInfo, context);
          this.logger.warn(
            `[${context || 'TikTok API'}] Attempt ${attempt}/3 failed. Retrying in ${delayMs}ms...`,
          );
        },
      },
      this.logger,
    );
  }

  /**
   * リトライ対応のPOSTリクエスト
   * @param url エンドポイントURL
   * @param data リクエストボディ
   * @param config Axiosリクエスト設定
   * @param context ログ出力用のコンテキスト名
   */
  private async httpPostWithRetry<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
    context?: string,
  ): Promise<AxiosResponse<T>> {
    return withRetry(
      () => this.httpClient.post<T>(url, data, config),
      {
        maxRetries: 3,
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        retryableErrors: isTikTokErrorRetryable,
        onRetry: (error, attempt, delayMs) => {
          const errorInfo = classifyTikTokError(error);
          logTikTokError(this.logger, errorInfo, context);
          this.logger.warn(
            `[${context || 'TikTok API'}] Attempt ${attempt}/3 failed. Retrying in ${delayMs}ms...`,
          );
        },
      },
      this.logger,
    );
  }

  /**
   * TikTok APIエラーを分類してログ出力し、適切なエラーをスロー
   * @param error キャッチしたエラー
   * @param context エラーコンテキスト
   */
  private handleTikTokError(error: any, context: string): never {
    const errorInfo = classifyTikTokError(error);
    logTikTokError(this.logger, errorInfo, context);

    // エラータイプに応じて適切なエラーメッセージを設定
    const enhancedError = new Error(`[${context}] ${errorInfo.message}`);
    (enhancedError as any).type = errorInfo.type;
    (enhancedError as any).code = errorInfo.code;
    (enhancedError as any).isRetryable = errorInfo.isRetryable;
    (enhancedError as any).originalError = error;

    throw enhancedError;
  }

  /**
   * Auth Codeを使ってAccess Token + Refresh Tokenを取得
   * TikTok Business API v1.3を使用
   */
  async getAccessToken(authCode: string) {
    try {
      this.logger.log(`Attempting to get access token with auth code: ${authCode.substring(0, 10)}...`);

      const response = await this.httpClient.post('/v1.3/oauth2/access_token/', {
        app_id: this.appId,
        secret: this.appSecret,
        auth_code: authCode,
      });

      this.logger.log('Access token retrieved successfully');
      this.logger.log('Token data:', JSON.stringify(response.data, null, 2));

      // トークンをDBに保存
      if (response.data.data?.access_token && response.data.data?.advertiser_ids?.length > 0) {
        await this.saveTokens(
          response.data.data.advertiser_ids,
          response.data.data.access_token,
          response.data.data.refresh_token,
          response.data.data.scope,
        );
      }

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get access token', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * トークンをDBに保存（複数のAdvertiser用）
   */
  async saveTokens(
    advertiserIds: string[],
    accessToken: string,
    refreshToken?: string,
    scope?: number[],
  ) {
    try {
      // 無期限トークンのため、遠い未来の日付に設定
      const expiresAt = new Date('2099-12-31T23:59:59Z');

      const scopeStr = scope ? JSON.stringify(scope) : null;

      // TikTok APIから全広告主の情報を一括取得
      let advertiserNameMap: { [key: string]: string } = {};
      try {
        const advertiserData = await this.getAdvertiserInfo(accessToken);
        if (advertiserData?.data?.list) {
          for (const adv of advertiserData.data.list) {
            advertiserNameMap[adv.advertiser_id] = adv.advertiser_name || `Advertiser ${adv.advertiser_id}`;
          }
        }
      } catch (error) {
        this.logger.warn('Failed to fetch advertiser names, using fallback names');
      }

      // 各Advertiser用にトークンを保存
      for (const advertiserId of advertiserIds) {
        // マッピングから名前を取得、なければフォールバック
        const advertiserName = advertiserNameMap[advertiserId] || `Advertiser ${advertiserId}`;

        // まずAdvertiserレコードを作成（存在しない場合）
        await this.prisma.advertiser.upsert({
          where: { tiktokAdvertiserId: advertiserId },
          create: {
            tiktokAdvertiserId: advertiserId,
            name: advertiserName,
          },
          update: {
            name: advertiserName, // 既存の場合も名前を更新
          },
        });

        // 次にOAuthTokenを保存
        await this.prisma.oAuthToken.upsert({
          where: { advertiserId },
          create: {
            advertiserId,
            accessToken,
            refreshToken: refreshToken || null,
            expiresAt,
            scope: scopeStr,
          },
          update: {
            accessToken,
            refreshToken: refreshToken || undefined,
            expiresAt,
            scope: scopeStr,
          },
        });

        this.logger.log(`Token saved for advertiser: ${advertiserId}`);
      }

      this.logger.log(`Saved tokens for ${advertiserIds.length} advertisers`);
    } catch (error) {
      this.logger.error('Failed to save tokens to database', error);
      throw error;
    }
  }

  /**
   * Refresh Tokenを使ってAccess Tokenを更新
   * TikTok Business API v1.3を使用
   */
  async refreshAccessToken(refreshToken: string) {
    try {
      this.logger.log('Attempting to refresh access token');

      const response = await this.httpClient.post('/v1.3/oauth2/refresh_token/', {
        app_id: this.appId,
        secret: this.appSecret,
        refresh_token: refreshToken,
      });

      this.logger.log('Access token refreshed successfully');
      this.logger.log('Refreshed token data:', JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      this.logger.error('Failed to refresh access token', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * OAuth認証URLを生成
   */
  getAuthUrl(): string {
    const params = new URLSearchParams({
      app_id: this.appId,
      redirect_uri: this.redirectUri,
      state: 'STATE', // CSRF対策用（本番ではランダム生成）
    });

    return `https://business-api.tiktok.com/portal/auth?${params.toString()}`;
  }

  /**
   * アクセストークンを使ってAdvertiser情報を取得
   */
  async getAdvertiserInfo(accessToken: string) {
    try {
      this.logger.log('Fetching advertiser info with access token');

      const response = await this.httpClient.get('/v1.3/oauth2/advertiser/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params: {
          app_id: this.appId,
          secret: this.appSecret,
        },
      });

      this.logger.log('Advertiser info retrieved successfully');
      this.logger.log('Advertiser data:', JSON.stringify(response.data, null, 2));

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get advertiser info', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 既存のアクセストークンから全アカウントを同期
   * DBに保存されているトークンを使って、アクセス可能な全てのAdvertiserを取得・登録
   */
  async syncAllAdvertisersFromToken() {
    try {
      this.logger.log('Starting advertiser synchronization from existing token');

      // DBから有効なOAuthTokenを1つ取得
      const existingToken = await this.prisma.oAuthToken.findFirst({
        where: {
          expiresAt: {
            gt: new Date(),
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!existingToken) {
        throw new Error('No valid OAuth token found in database');
      }

      this.logger.log(`Using token for advertiser: ${existingToken.advertiserId}`);

      // このトークンでアクセス可能な全Advertiser情報を取得
      const advertiserData = await this.getAdvertiserInfo(existingToken.accessToken);

      if (!advertiserData?.data?.list || advertiserData.data.list.length === 0) {
        throw new Error('No advertisers found for this token');
      }

      const advertisers = advertiserData.data.list;
      this.logger.log(`Found ${advertisers.length} advertisers accessible with this token`);

      // 無期限トークンのため、遠い未来の日付に設定
      const expiresAt = new Date('2099-12-31T23:59:59Z');

      // 各Advertiserに対して、同じトークンでレコードを作成/更新
      let syncedCount = 0;
      for (const adv of advertisers) {
        const advertiserId = adv.advertiser_id;
        const advertiserName = adv.advertiser_name || `Advertiser ${advertiserId}`;

        // Advertiserレコードを作成/更新
        await this.prisma.advertiser.upsert({
          where: { tiktokAdvertiserId: advertiserId },
          create: {
            tiktokAdvertiserId: advertiserId,
            name: advertiserName,
          },
          update: {
            name: advertiserName,
          },
        });

        // OAuthTokenを作成/更新
        await this.prisma.oAuthToken.upsert({
          where: { advertiserId },
          create: {
            advertiserId,
            accessToken: existingToken.accessToken,
            refreshToken: existingToken.refreshToken,
            scope: existingToken.scope,
            expiresAt,
          },
          update: {
            accessToken: existingToken.accessToken,
            refreshToken: existingToken.refreshToken,
            scope: existingToken.scope,
            expiresAt,
          },
        });

        this.logger.log(`Synced advertiser: ${advertiserId} (${advertiserName})`);
        syncedCount++;
      }

      this.logger.log(`Successfully synced ${syncedCount} advertisers`);

      return {
        syncedCount,
        advertisers: advertisers.map(adv => ({
          id: adv.advertiser_id,
          name: adv.advertiser_name,
        })),
      };
    } catch (error) {
      this.logger.error('Failed to sync advertisers from token', error);
      throw error;
    }
  }

  /**
   * Campaign一覧を取得
   * GET /v1.3/campaign/get/
   * リトライ対応: タイムアウト、レート制限、サーバーエラー時に自動リトライ
   */
  async getCampaigns(advertiserId: string, accessToken: string, campaignIds?: string[]) {
    try {
      this.logger.log(`Fetching campaigns for advertiser: ${advertiserId}`);

      const requestBody: any = {
        advertiser_id: advertiserId,
        page_size: 100, // TikTok API v1.3の最大値
      };

      if (campaignIds && campaignIds.length > 0) {
        requestBody.filtering = {
          campaign_ids: campaignIds,
        };
      }

      const response = await this.httpGetWithRetry('/v1.3/campaign/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params: requestBody,
      }, 'getCampaigns');

      this.logger.log(`Retrieved ${response.data.data?.list?.length || 0} campaigns`);
      return response.data;
    } catch (error) {
      this.handleTikTokError(error, 'getCampaigns');
    }
  }

  /**
   * 全Campaign一覧を取得（ページネーション対応）
   * GET /v1.3/campaign/get/
   * リトライ対応: 各ページ取得時に自動リトライ
   */
  async getAllCampaigns(advertiserId: string, accessToken: string) {
    const allData: any[] = [];
    let currentPage = 1;
    const pageSize = 100;
    let hasMorePages = true;

    this.logger.log(`Fetching all campaigns for advertiser: ${advertiserId}`);

    while (hasMorePages) {
      try {
        const response = await this.httpGetWithRetry('/v1.3/campaign/get/', {
          headers: {
            'Access-Token': accessToken,
          },
          params: {
            advertiser_id: advertiserId,
            page_size: pageSize,
            page: currentPage,
          },
        }, `getAllCampaigns(page=${currentPage})`);

        const list = response.data.data?.list || [];
        if (list.length > 0) {
          allData.push(...list);

          const totalNumber = response.data.data?.page_info?.total_number || 0;
          const totalPages = Math.ceil(totalNumber / pageSize);

          if (currentPage >= totalPages) {
            hasMorePages = false;
          } else {
            currentPage++;
          }
        } else {
          hasMorePages = false;
        }
      } catch (error) {
        this.handleTikTokError(error, `getAllCampaigns(page=${currentPage})`);
      }
    }

    this.logger.log(`Fetched total ${allData.length} campaigns across ${currentPage} pages`);
    return allData;
  }

  /**
   * Ad Group（広告セット）一覧を取得
   * GET /v1.3/adgroup/get/
   * リトライ対応: タイムアウト、レート制限、サーバーエラー時に自動リトライ
   */
  async getAdGroups(advertiserId: string, accessToken: string, campaignIds?: string[]) {
    try {
      this.logger.log(`Fetching ad groups for advertiser: ${advertiserId}`);

      const params: any = {
        advertiser_id: advertiserId,
        page_size: 100, // TikTok API v1.3の最大値
      };

      if (campaignIds && campaignIds.length > 0) {
        params.filtering = JSON.stringify({
          campaign_ids: campaignIds,
        });
      }

      this.logger.log(`Request params: ${JSON.stringify(params)}`);

      const response = await this.httpGetWithRetry('/v1.3/adgroup/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params,
      }, 'getAdGroups');

      this.logger.log(`Retrieved ${response.data.data?.list?.length || 0} ad groups`);
      return response.data;
    } catch (error) {
      this.handleTikTokError(error, 'getAdGroups');
    }
  }

  /**
   * 全Ad Group一覧を取得（ページネーション対応）
   * GET /v1.3/adgroup/get/
   * リトライ対応: 各ページ取得時に自動リトライ
   */
  async getAllAdGroups(advertiserId: string, accessToken: string) {
    const allData: any[] = [];
    let currentPage = 1;
    const pageSize = 100;
    let hasMorePages = true;

    this.logger.log(`Fetching all ad groups for advertiser: ${advertiserId}`);

    while (hasMorePages) {
      try {
        const response = await this.httpGetWithRetry('/v1.3/adgroup/get/', {
          headers: {
            'Access-Token': accessToken,
          },
          params: {
            advertiser_id: advertiserId,
            page_size: pageSize,
            page: currentPage,
          },
        }, `getAllAdGroups(page=${currentPage})`);

        const list = response.data.data?.list || [];
        if (list.length > 0) {
          allData.push(...list);

          const totalNumber = response.data.data?.page_info?.total_number || 0;
          const totalPages = Math.ceil(totalNumber / pageSize);

          if (currentPage >= totalPages) {
            hasMorePages = false;
          } else {
            currentPage++;
          }
        } else {
          hasMorePages = false;
        }
      } catch (error) {
        this.handleTikTokError(error, `getAllAdGroups(page=${currentPage})`);
      }
    }

    this.logger.log(`Fetched total ${allData.length} ad groups across ${currentPage} pages`);
    return allData;
  }

  /**
   * 単一Ad Group取得
   * GET /v1.3/adgroup/get/
   */
  async getAdGroup(advertiserId: string, accessToken: string, adgroupId: string) {
    try {
      this.logger.log(`Fetching adgroup: ${adgroupId}`);

      // M-01: リトライ対応に変更
      const response = await this.httpGetWithRetry('/v1.3/adgroup/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params: {
          advertiser_id: advertiserId,
          filtering: JSON.stringify({
            adgroup_ids: [adgroupId],
          }),
        },
      }, `getAdGroup(${adgroupId})`);

      const adgroups = response.data.data?.list || [];
      if (adgroups.length === 0) {
        throw new Error(`AdGroup not found: ${adgroupId}`);
      }

      return adgroups[0];
    } catch (error) {
      this.logger.error('Failed to get adgroup', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * AdGroup更新
   * POST /v1.2/adgroup/update/
   */
  async updateAdGroup(
    advertiserId: string,
    accessToken: string,
    adgroupId: string,
    updates: {
      budget?: number;
      status?: string;
    },
  ) {
    try {
      this.logger.log(`Updating adgroup: ${adgroupId}`);

      const requestBody: any = {
        advertiser_id: advertiserId,
        adgroup_id: adgroupId,
      };

      if (updates.budget) {
        requestBody.budget = updates.budget;
      }

      if (updates.status) {
        requestBody.operation_status = updates.status;
      }

      const response = await this.httpClient.post('/v1.2/adgroup/update/', requestBody, {
        headers: {
          'Access-Token': accessToken,
        },
      });

      this.logger.log(`AdGroup update response: ${JSON.stringify(response.data)}`);

      // TikTok APIのレスポンスコードをチェック
      if (response.data.code !== 0) {
        const error = new Error(`TikTok API error: ${response.data.message}`);
        this.logger.error('Failed to update adgroup', response.data);
        throw error;
      }

      this.logger.log('AdGroup updated successfully');
      return response.data;
    } catch (error) {
      this.logger.error('Failed to update adgroup', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Ad（広告）一覧を取得
   * GET /v1.3/ad/get/
   * リトライ対応: タイムアウト、レート制限、サーバーエラー時に自動リトライ
   */
  async getAds(advertiserId: string, accessToken: string, adgroupIds?: string[], operationStatus?: string) {
    try {
      this.logger.log(`Fetching ads for advertiser: ${advertiserId}`);

      const params: any = {
        advertiser_id: advertiserId,
        page_size: 100, // TikTok API v1.3の最大値
      };

      const filtering: any = {};
      if (adgroupIds && adgroupIds.length > 0) {
        filtering.adgroup_ids = adgroupIds;
      }
      if (operationStatus) {
        filtering.operation_status = operationStatus;
      }
      if (Object.keys(filtering).length > 0) {
        params.filtering = JSON.stringify(filtering);
      }

      this.logger.log(`Request params: ${JSON.stringify(params)}`);

      const response = await this.httpGetWithRetry('/v1.3/ad/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params,
      }, 'getAds');

      this.logger.log(`Retrieved ${response.data.data?.list?.length || 0} ads`);
      return response.data;
    } catch (error) {
      this.handleTikTokError(error, 'getAds');
    }
  }

  /**
   * 全Ad一覧を取得（ページネーション対応）
   * GET /v1.3/ad/get/
   * リトライ対応: 各ページ取得時に自動リトライ
   */
  async getAllAds(advertiserId: string, accessToken: string) {
    const allData: any[] = [];
    let currentPage = 1;
    const pageSize = 100;
    let hasMorePages = true;

    this.logger.log(`Fetching all ads for advertiser: ${advertiserId}`);

    while (hasMorePages) {
      try {
        const response = await this.httpGetWithRetry('/v1.3/ad/get/', {
          headers: {
            'Access-Token': accessToken,
          },
          params: {
            advertiser_id: advertiserId,
            page_size: pageSize,
            page: currentPage,
          },
        }, `getAllAds(page=${currentPage})`);

        const list = response.data.data?.list || [];
        if (list.length > 0) {
          allData.push(...list);

          const totalNumber = response.data.data?.page_info?.total_number || 0;
          const totalPages = Math.ceil(totalNumber / pageSize);

          if (currentPage >= totalPages) {
            hasMorePages = false;
          } else {
            currentPage++;
          }
        } else {
          hasMorePages = false;
        }
      } catch (error) {
        this.handleTikTokError(error, `getAllAds(page=${currentPage})`);
      }
    }

    this.logger.log(`Fetched total ${allData.length} ads across ${currentPage} pages`);
    return allData;
  }

  /**
   * 単一Ad取得
   * GET /v1.3/ad/get/
   */
  async getAd(advertiserId: string, accessToken: string, adId: string) {
    try {
      this.logger.log(`Fetching ad: ${adId}`);

      const response = await this.httpClient.get('/v1.3/ad/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params: {
          advertiser_id: advertiserId,
          filtering: JSON.stringify({
            ad_ids: [adId],
          }),
        },
      });

      const ads = response.data.data?.list || [];
      if (ads.length === 0) {
        throw new Error(`Ad not found: ${adId}`);
      }

      this.logger.log(`Ad fetched successfully: ${JSON.stringify(ads[0])}`);
      return ads[0];
    } catch (error) {
      this.logger.error('Failed to get ad', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 広告ステータス更新（専用エンドポイント）
   * POST /v1.3/ad/status/update/
   *
   * 広告のステータス（ENABLE/DISABLE/DELETE）を変更する専用API
   */
  async updateAdStatus(
    advertiserId: string,
    accessToken: string,
    adIds: string[],
    operationStatus: 'ENABLE' | 'DISABLE' | 'DELETE',
  ) {
    try {
      this.logger.log(`Updating ad status: ${adIds.join(', ')} to ${operationStatus}`);

      const requestBody = {
        advertiser_id: advertiserId,
        ad_ids: adIds,
        operation_status: operationStatus,
      };

      this.logger.log(`Request body for ad status update: ${JSON.stringify(requestBody)}`);

      const response = await this.httpClient.post('/v1.3/ad/status/update/', requestBody, {
        headers: {
          'Access-Token': accessToken,
        },
      });

      this.logger.log(`Ad status update response: ${JSON.stringify(response.data)}`);

      // TikTok APIのレスポンスコードをチェック
      if (response.data.code !== 0) {
        const error = new Error(`TikTok API error: ${response.data.message}`);
        this.logger.error('Failed to update ad status', response.data);
        throw error;
      }

      this.logger.log('Ad status updated successfully');
      return response.data;
    } catch (error) {
      this.logger.error('Failed to update ad status', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Ad更新（コンテンツ更新用）
   * POST /v1.3/ad/update/
   *
   * 注意: TikTok APIの仕様により、広告更新時にはcreativesフィールドが必要です。
   * そのため、まず広告情報を取得してから更新します。
   */
  async updateAd(
    advertiserId: string,
    accessToken: string,
    adId: string,
    adgroupId: string,
    updates: {
      status?: string;
    },
  ) {
    try {
      this.logger.log(`Updating ad: ${adId}`);

      // まず現在の広告情報を取得
      const currentAd = await this.getAd(advertiserId, accessToken, adId);
      this.logger.log(`Current ad data retrieved for update`);

      const requestBody: any = {
        advertiser_id: advertiserId,
        ad_id: adId,
        adgroup_id: adgroupId,
      };

      // 広告名（必須）
      if (currentAd.ad_name) {
        requestBody.ad_name = currentAd.ad_name;
      }

      // 広告テキスト（必須）
      if (currentAd.ad_text) {
        requestBody.ad_text = currentAd.ad_text;
      }

      // クリエイティブ情報を構築
      // TikTok v1.3 APIは creatives フィールドを必須とする
      // creatives配列内に identity_id, identity_type, call_to_action_id が必要
      if (currentAd.creatives && currentAd.creatives.length > 0) {
        requestBody.creatives = currentAd.creatives;
      } else if (currentAd.video_id || (currentAd.image_ids && currentAd.image_ids.length > 0)) {
        // creatives配列が取得できなかった場合は、広告データから構築
        const creative: any = {
          ad_id: currentAd.ad_id,
          ad_name: currentAd.ad_name,
          ad_text: currentAd.ad_text,
          ad_format: currentAd.ad_format,
          video_id: currentAd.video_id,
          image_ids: currentAd.image_ids || [],
          landing_page_url: currentAd.landing_page_url,
          identity_id: currentAd.identity_id,
          identity_type: currentAd.identity_type,
        };

        // call_to_action_id がある場合のみ追加（v1.3 では call_to_action ではなく call_to_action_id を使用）
        if (currentAd.call_to_action_id) {
          creative.call_to_action_id = currentAd.call_to_action_id;
        }

        requestBody.creatives = [creative];
      }

      // ステータス更新
      if (updates.status) {
        requestBody.operation_status = updates.status;
      }

      this.logger.log(`Request body for ad update: ${JSON.stringify(requestBody)}`);

      const response = await this.httpClient.post('/v1.3/ad/update/', requestBody, {
        headers: {
          'Access-Token': accessToken,
        },
      });

      this.logger.log(`Update response: ${JSON.stringify(response.data)}`);

      // TikTok APIのレスポンスコードをチェック
      if (response.data.code !== 0) {
        const error = new Error(`TikTok API error: ${response.data.message}`);
        this.logger.error('Failed to update ad', response.data);
        throw error;
      }

      this.logger.log('Ad updated successfully');
      return response.data;
    } catch (error) {
      this.logger.error('Failed to update ad', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 単一Campaign取得
   */
  async getCampaign(advertiserId: string, accessToken: string, campaignId: string) {
    try {
      this.logger.log(`Fetching campaign: ${campaignId}`);

      const response = await this.httpClient.get('/v1.3/campaign/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params: {
          advertiser_id: advertiserId,
          filtering: {
            campaign_ids: [campaignId],
          },
        },
      });

      const campaigns = response.data.data?.list || [];
      if (campaigns.length === 0) {
        throw new Error(`Campaign not found: ${campaignId}`);
      }

      return campaigns[0];
    } catch (error) {
      this.logger.error('Failed to get campaign', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Campaign作成
   * POST /v1.2/campaign/create/
   */
  async createCampaign(
    advertiserId: string,
    accessToken: string,
    campaignName: string,
    objectiveType: string,
    budgetMode?: string,
    budget?: number,
    advertiserUuid?: string,
  ) {
    try {
      this.logger.log(`Creating campaign: ${campaignName} for advertiser: ${advertiserId}`);

      const requestBody: any = {
        advertiser_id: advertiserId,
        campaign_name: campaignName,
        objective_type: objectiveType,
      };

      if (budgetMode) {
        requestBody.budget_mode = budgetMode;
      }

      if (budget) {
        requestBody.budget = budget;
      }

      const response = await this.httpClient.post('/v1.2/campaign/create/', requestBody, {
        headers: {
          'Access-Token': accessToken,
        },
      });

      // TikTok APIのビジネスエラーチェック（HTTP 200でもcode!=0はエラー）
      if (response.data.code && response.data.code !== 0) {
        const errMsg = `TikTok API error: code=${response.data.code}, message=${response.data.message}`;
        this.logger.error(errMsg);
        throw new Error(errMsg);
      }

      this.logger.log('Campaign created successfully');
      this.logger.log('Campaign data:', JSON.stringify(response.data, null, 2));

      // DBに保存
      if (response.data.data?.campaign_id) {
        await this.prisma.campaign.create({
          data: {
            tiktokId: String(response.data.data.campaign_id),
            advertiserId: advertiserUuid || advertiserId, // Use UUID if provided
            name: campaignName,
            objectiveType,
            budgetMode: budgetMode || null,
            budget: budget || null,
            status: 'ENABLE',
          },
        });
        this.logger.log(`Campaign saved to database: ${response.data.data.campaign_id}`);
      }

      return response.data;
    } catch (error) {
      this.logger.error('Failed to create campaign', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * AdGroup作成
   * POST /v1.2/adgroup/create/
   */
  async createAdGroup(
    advertiserId: string,
    campaignId: string,
    adgroupName: string,
    options: {
      placementType?: string;
      placements?: string[];
      budgetMode?: string;
      budget?: number;
      bidType?: string;
      bidPrice?: number;
      optimizationGoal?: string;
      pixelId?: string;
      optimizationEvent?: string;
      targeting?: any;
      scheduleStartTime?: string;
      scheduleEndTime?: string;
      commentDisabled?: boolean;
    },
    accessToken: string,
  ) {
    try {
      this.logger.log(`Creating adgroup: ${adgroupName} for campaign: ${campaignId}`);

      const requestBody: any = {
        advertiser_id: advertiserId,
        campaign_id: campaignId,
        adgroup_name: adgroupName,
        promotion_type: 'LEAD_GENERATION', // API v1.3: LEAD_GENERATION for lead gen campaigns
        promotion_target_type: 'EXTERNAL_WEBSITE', // Required for website-based lead generation
        placement_type: options.placementType || 'PLACEMENT_TYPE_NORMAL',
        placements: options.placements || ['PLACEMENT_TIKTOK'],
        location_ids: options.targeting?.location_ids || ['6252001'],
        languages: options.targeting?.languages || ['ja'],
        age_groups: options.targeting?.age_groups || ['AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_100'],
        gender: options.targeting?.gender || 'GENDER_UNLIMITED',
        budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET', // API v1.3: Dynamic daily budget for LEAD_GENERATION
        budget: options.budget,
        bid_type: options.bidType || 'BID_TYPE_NO_BID',
        billing_event: 'OCPM', // Optimized Cost per Mille for automatic bidding
        optimization_goal: options.optimizationGoal || 'CONVERT', // API v1.3: CONVERT for LEAD_GENERATION campaigns
        schedule_type: 'SCHEDULE_FROM_NOW', // API v1.3: SCHEDULE_FROM_NOW for continuous campaigns
        schedule_start_time: options.scheduleStartTime || this.getScheduleStartTime(),
        pacing: 'PACING_MODE_SMOOTH', // Smooth pacing for better delivery
        skip_learning_phase: true, // Skip learning phase
        video_download_disabled: true, // Disable video downloads
        click_attribution_window: 'SEVEN_DAYS', // 7-day click attribution
        view_attribution_window: 'ONE_DAY', // 1-day view attribution
        brand_safety_type: 'STANDARD_INVENTORY', // Standard brand safety
      };

      if (options.bidPrice) {
        requestBody.bid_price = options.bidPrice;
      }

      if (options.pixelId) {
        requestBody.pixel_id = options.pixelId;
      }

      if (options.optimizationEvent) {
        // API v1.3: Use optimization_event string constant instead of conversion_id
        // For ON_WEB_REGISTER event, use the string constant directly
        requestBody.optimization_event = 'ON_WEB_REGISTER';
      }

      if (options.targeting?.included_custom_audiences) {
        requestBody.included_custom_audiences = options.targeting.included_custom_audiences;
      }

      if (options.targeting?.excluded_custom_audiences) {
        requestBody.excluded_custom_audiences = options.targeting.excluded_custom_audiences;
      }

      if (options.targeting?.spending_power) {
        requestBody.spending_power = options.targeting.spending_power;
      }

      if (options.commentDisabled) {
        requestBody.comment_disabled = true;
      }

      // Log request body for debugging
      this.logger.log('AdGroup create request body:', JSON.stringify(requestBody, null, 2));

      const response = await this.httpClient.post('/v1.3/adgroup/create/', requestBody, {
        headers: {
          'Access-Token': accessToken,
        },
      });

      // TikTok APIのビジネスエラーチェック（HTTP 200でもcode!=0はエラー）
      if (response.data.code && response.data.code !== 0) {
        const errMsg = `TikTok API error: code=${response.data.code}, message=${response.data.message}`;
        this.logger.error(errMsg);
        throw new Error(errMsg);
      }

      this.logger.log('AdGroup created successfully');
      this.logger.log('AdGroup data:', JSON.stringify(response.data, null, 2));

      // DBに保存
      if (response.data.data?.adgroup_id) {
        // Find Campaign UUID from TikTok Campaign ID
        const campaign = await this.prisma.campaign.findUnique({
          where: { tiktokId: campaignId },
        });

        if (!campaign) {
          this.logger.error(`Campaign not found in DB: ${campaignId}`);
          throw new Error(`Campaign not found in database: ${campaignId}`);
        }

        await this.prisma.adGroup.create({
          data: {
            tiktokId: String(response.data.data.adgroup_id),
            campaignId: campaign.id, // Use Campaign UUID instead of TikTok Campaign ID
            name: adgroupName,
            placementType: options.placementType,
            budgetMode: options.budgetMode,
            budget: options.budget,
            bidType: options.bidType,
            bidPrice: options.bidPrice,
            targeting: options.targeting,
            schedule: {
              startTime: options.scheduleStartTime,
              endTime: options.scheduleEndTime,
            },
            status: 'ENABLE',
          },
        });
        this.logger.log(`AdGroup saved to database: ${response.data.data.adgroup_id}`);
      }

      return response.data;
    } catch (error) {
      this.logger.error('Failed to create adgroup', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Ad作成
   * POST /v1.2/ad/create/
   */
  async createAd(
    advertiserId: string,
    adgroupId: string,
    adName: string,
    options: {
      identity?: string;
      identityType?: string;
      identityAuthorizedBcId?: string;
      videoId?: string;
      imageIds?: string[];
      adText?: string;
      callToAction?: string;
      landingPageUrl?: string;
      displayMode?: string;
      creativeAuthorized?: boolean;
    },
    accessToken: string,
  ) {
    try {
      this.logger.log(`Creating ad: ${adName} for adgroup: ${adgroupId}`);

      // API v1.3: Use creatives array format
      const creative: any = {
        ad_name: adName,
        ad_text: options.adText,
        call_to_action: options.callToAction || 'LEARN_MORE',
        landing_page_url: options.landingPageUrl,
        identity_id: options.identity || 'a356c51a-18f2-5f1e-b784-ccb3b107099e',
        identity_type: options.identityType || 'BC_AUTH_TT',
      };

      // BC_AUTH_TT使用時はbc_idが必要
      if ((options.identityType || 'BC_AUTH_TT') === 'BC_AUTH_TT' && options.identityAuthorizedBcId) {
        creative.identity_authorized_bc_id = options.identityAuthorizedBcId;
      }

      // Set ad_format based on creative type
      if (options.videoId) {
        creative.video_id = options.videoId;
        creative.ad_format = 'SINGLE_VIDEO';
        // SINGLE_VIDEOの場合もサムネイル画像が必要
        if (options.imageIds && options.imageIds.length > 0) {
          creative.image_ids = options.imageIds;
        }
      } else if (options.imageIds && options.imageIds.length > 0) {
        creative.image_ids = options.imageIds;
        creative.ad_format = 'SINGLE_IMAGE';
      }

      const requestBody: any = {
        advertiser_id: advertiserId,
        adgroup_id: adgroupId,
        is_smart_creative: options.creativeAuthorized || false,
        creatives: [creative], // API v1.3: creatives array
      };

      // Log request body for debugging
      this.logger.log('Ad create request body:');
      this.logger.log(JSON.stringify(requestBody, null, 2));

      const response = await this.httpClient.post('/v1.3/ad/create/', requestBody, {
        headers: {
          'Access-Token': accessToken,
        },
      });

      // TikTok APIのビジネスエラーチェック（HTTP 200でもcode!=0はエラー）
      if (response.data.code && response.data.code !== 0) {
        const errMsg = `TikTok API error: code=${response.data.code}, message=${response.data.message}`;
        this.logger.error(errMsg);
        throw new Error(errMsg);
      }

      this.logger.log('Ad created successfully');
      this.logger.log('Ad data:', JSON.stringify(response.data, null, 2));

      // DBに保存
      if (response.data.data?.ad_id) {
        // まず、creativeIdを取得する必要がある（videoIdまたはimageIdから検索）
        let creativeId: string | null = null;
        if (options.videoId) {
          const creative = await this.prisma.creative.findFirst({
            where: { tiktokVideoId: options.videoId },
          });
          creativeId = creative?.id || null;
        } else if (options.imageIds && options.imageIds.length > 0) {
          const creative = await this.prisma.creative.findFirst({
            where: { tiktokImageId: options.imageIds[0] },
          });
          creativeId = creative?.id || null;
        }

        if (creativeId) {
          await this.prisma.ad.create({
            data: {
              tiktokId: String(response.data.data.ad_id),
              adgroupId,
              name: adName,
              creativeId,
              adText: options.adText,
              callToAction: options.callToAction,
              landingPageUrl: options.landingPageUrl,
              displayName: options.identity,
              status: 'ENABLE',
              reviewStatus: 'IN_REVIEW',
            },
          });
          this.logger.log(`Ad saved to database: ${response.data.data.ad_id}`);
        }
      }

      return response.data;
    } catch (error) {
      this.logger.error('Failed to create ad', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Campaign更新
   * POST /v1.2/campaign/update/
   */
  async updateCampaign(
    advertiserId: string,
    accessToken: string,
    campaignId: string,
    updates: {
      campaignName?: string;
      budgetMode?: string;
      budget?: number;
      status?: string;
    },
  ) {
    try {
      this.logger.log(`Updating campaign: ${campaignId}`);

      const requestBody: any = {
        advertiser_id: advertiserId,
        campaign_id: campaignId,
      };

      if (updates.campaignName) {
        requestBody.campaign_name = updates.campaignName;
      }

      if (updates.budgetMode) {
        requestBody.budget_mode = updates.budgetMode;
      }

      if (updates.budget) {
        requestBody.budget = updates.budget;
      }

      if (updates.status) {
        requestBody.operation_status = updates.status;
      }

      const response = await this.httpClient.post('/v1.2/campaign/update/', requestBody, {
        headers: {
          'Access-Token': accessToken,
        },
      });

      this.logger.log('Campaign updated successfully');

      // DBも更新
      await this.prisma.campaign.updateMany({
        where: { tiktokId: campaignId },
        data: {
          name: updates.campaignName,
          budgetMode: updates.budgetMode,
          budget: updates.budget,
          status: updates.status,
        },
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to update campaign', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * レポート取得（統合レポートAPI）
   * GET /v1.3/report/integrated/get/
   * ページネーション対応で全データ取得
   */
  async getReport(
    advertiserId: string,
    accessToken: string,
    options: {
      dataLevel: 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD';
      startDate: string; // YYYY-MM-DD
      endDate: string; // YYYY-MM-DD
      dimensions?: string[];
      metrics?: string[];
      filtering?: any;
      page?: number;
      pageSize?: number;
    },
  ) {
    try {
      const {
        dataLevel,
        startDate,
        endDate,
        dimensions,
        metrics = [
          'impressions',
          'clicks',
          'spend',
          'ctr',
          'cpc',
          'cpm',
        ],
        filtering,
        page = 1,
        pageSize = 1000,
      } = options;

      // データレベルに応じて必要なdimensionsを設定
      let reportDimensions = dimensions || ['stat_time_day'];
      if (!dimensions) {
        if (dataLevel === 'AUCTION_CAMPAIGN') {
          reportDimensions = ['stat_time_day', 'campaign_id'];
        } else if (dataLevel === 'AUCTION_ADGROUP') {
          reportDimensions = ['stat_time_day', 'adgroup_id'];
        } else if (dataLevel === 'AUCTION_AD') {
          reportDimensions = ['stat_time_day', 'ad_id'];
        }
      }

      this.logger.log(`Fetching report for advertiser: ${advertiserId}, level: ${dataLevel}, period: ${startDate} ~ ${endDate}`);

      const params: any = {
        advertiser_id: advertiserId,
        data_level: dataLevel,
        report_type: 'BASIC',
        dimensions: JSON.stringify(reportDimensions),
        metrics: JSON.stringify(metrics),
        start_date: startDate,
        end_date: endDate,
        page,
        page_size: pageSize,
      };

      if (filtering) {
        params.filtering = JSON.stringify(filtering);
      }

      const response = await this.httpGetWithRetry('/v1.3/report/integrated/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params,
      }, `getReport(${dataLevel})`);

      this.logger.log(`Retrieved report data: ${response.data.data?.list?.length || 0} records`);
      this.logger.log(`Full API response: ${JSON.stringify(response.data, null, 2)}`);
      return response.data;
    } catch (error) {
      this.handleTikTokError(error, `getReport(${options.dataLevel})`);
    }
  }

  /**
   * 全ページのレポートデータを取得
   * ページネーションを自動処理
   */
  async getAllReportData(
    advertiserId: string,
    accessToken: string,
    options: {
      dataLevel: 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD';
      startDate: string;
      endDate: string;
      dimensions?: string[];
      metrics?: string[];
      filtering?: any;
    },
  ) {
    const allData: any[] = [];
    let currentPage = 1;
    const pageSize = 1000;
    let hasMorePages = true;

    this.logger.log(`Fetching all report data for advertiser: ${advertiserId}`);

    while (hasMorePages) {
      const result = await this.getReport(advertiserId, accessToken, {
        ...options,
        page: currentPage,
        pageSize,
      });

      if (result.data?.list && result.data.list.length > 0) {
        allData.push(...result.data.list);

        const totalPages = Math.ceil((result.data.page_info?.total_number || 0) / pageSize);

        if (currentPage >= totalPages) {
          hasMorePages = false;
        } else {
          currentPage++;
        }
      } else {
        hasMorePages = false;
      }
    }

    this.logger.log(`Fetched total ${allData.length} records across ${currentPage} pages`);
    return allData;
  }

  /**
   * レポートデータをDBに保存
   */
  async saveReportMetrics(
    reportData: any[],
    dataLevel: string,
    advertiserId?: string,
  ) {
    try {
      this.logger.log(`Saving ${reportData.length} ${dataLevel} metrics to database`);

      for (const record of reportData) {
        const dateString = record.dimensions?.stat_time_day || record.stat_time_day;
        const statDate = parseStatDate(dateString);
        const metrics = record.metrics || {};

        // データレベルに応じて処理を分岐
        if (dataLevel === 'AUCTION_AD') {
          // ADレベルのメトリクス
          const adId = record.dimensions?.ad_id || record.ad_id;

          if (!adId) {
            this.logger.warn('Skipping AD record without ad_id');
            continue;
          }

          // デバッグ: 受信したレコードの構造をログ出力
          this.logger.debug(`Processing AD record - adId: ${adId}, statDate: ${statDate.toISOString()}`);
          this.logger.debug(`Raw metrics object: ${JSON.stringify(metrics)}`);

          // DBのAdレコードを検索（tiktokIdで）
          const ad = await this.prisma.ad.findUnique({
            where: { tiktokId: String(adId) },
          });

          if (!ad) {
            this.logger.warn(`Ad not found in DB: ${adId}`);
            continue;
          }

          // メトリクスを保存（ADレベル）- 重複を防ぐため既存レコードを削除してから作成
          const metricData = {
            entityType: 'AD',
            adId: ad.id,
            statDate: statDate,
            impressions: parseInt(metrics.impressions || '0', 10),
            clicks: parseInt(metrics.clicks || '0', 10),
            spend: parseFloat(metrics.spend || '0'),
            conversions: parseInt(metrics.conversions || '0', 10),
            ctr: parseFloat(metrics.ctr || '0'),
            cpc: parseFloat(metrics.cpc || '0'),
            cpm: parseFloat(metrics.cpm || '0'),
            cpa: parseFloat(metrics.cost_per_conversion || '0'),
            videoViews: parseInt(metrics.video_views || '0', 10),
            videoWatched2s: parseInt(metrics.video_watched_2s || '0', 10),
            videoWatched6s: parseInt(metrics.video_watched_6s || '0', 10),
          };

          // デバッグ: パース後のメトリクスデータをログ出力
          this.logger.debug(`Parsed metric data: ${JSON.stringify(metricData)}`);

          // トランザクションで削除と作成を実行（データ消失防止）
          await this.prisma.$transaction(async (tx) => {
            // 既存のメトリクスを削除（重複防止）
            await tx.metric.deleteMany({
              where: {
                entityType: 'AD',
                adId: ad.id,
                statDate: statDate,
              },
            });

            // 新しいメトリクスを作成
            await tx.metric.create({
              data: metricData,
            });
          });
          this.logger.debug(`Saved metric for ad ${adId}`);

        } else if (dataLevel === 'AUCTION_ADGROUP') {
          // ADGROUPレベルのメトリクス
          const adgroupId = record.dimensions?.adgroup_id || record.adgroup_id;

          if (!adgroupId) {
            this.logger.warn('Skipping ADGROUP record without adgroup_id');
            continue;
          }

          // DBのAdGroupレコードを検索（tiktokIdで）
          const adgroup = await this.prisma.adGroup.findUnique({
            where: { tiktokId: String(adgroupId) },
          });

          if (!adgroup) {
            this.logger.warn(`AdGroup not found in DB: ${adgroupId}`);
            continue;
          }

          // メトリクスを保存（ADGROUPレベル）- 重複を防ぐため既存レコードを削除してから作成
          const metricData = {
            entityType: 'ADGROUP',
            adgroupId: adgroup.id,
            statDate: statDate,
            impressions: parseInt(metrics.impressions || '0', 10),
            clicks: parseInt(metrics.clicks || '0', 10),
            spend: parseFloat(metrics.spend || '0'),
            conversions: parseInt(metrics.conversions || '0', 10),
            ctr: parseFloat(metrics.ctr || '0'),
            cpc: parseFloat(metrics.cpc || '0'),
            cpm: parseFloat(metrics.cpm || '0'),
            cpa: parseFloat(metrics.cost_per_conversion || '0'),
          };

          // トランザクションで削除と作成を実行（データ消失防止）
          await this.prisma.$transaction(async (tx) => {
            // 既存のメトリクスを削除（重複防止）
            await tx.metric.deleteMany({
              where: {
                entityType: 'ADGROUP',
                adgroupId: adgroup.id,
                statDate: statDate,
              },
            });

            // 新しいメトリクスを作成
            await tx.metric.create({
              data: metricData,
            });
          });

        } else if (dataLevel === 'AUCTION_CAMPAIGN') {
          // CAMPAIGNレベルのメトリクス
          const campaignId = record.dimensions?.campaign_id || record.campaign_id;

          if (!campaignId) {
            this.logger.warn('Skipping CAMPAIGN record without campaign_id');
            continue;
          }

          // DBのCampaignレコードを検索（tiktokIdで）
          const campaign = await this.prisma.campaign.findUnique({
            where: { tiktokId: String(campaignId) },
            include: {
              advertiser: {
                include: {
                  appeal: true,
                },
              },
            },
          });

          if (!campaign) {
            this.logger.warn(`Campaign not found in DB: ${campaignId}`);
            continue;
          }

          // メトリクスを保存（CAMPAIGNレベル）- 重複を防ぐため既存レコードを削除してから作成
          // 基本メトリクスデータ
          const metricData: any = {
            entityType: 'CAMPAIGN',
            campaignId: campaign.id,
            statDate: statDate,
            impressions: parseInt(metrics.impressions || '0', 10),
            clicks: parseInt(metrics.clicks || '0', 10),
            spend: parseFloat(metrics.spend || '0'),
            conversions: parseInt(metrics.conversions || '0', 10),
            ctr: parseFloat(metrics.ctr || '0'),
            cpc: parseFloat(metrics.cpc || '0'),
            cpm: parseFloat(metrics.cpm || '0'),
            cpa: parseFloat(metrics.cost_per_conversion || '0'),
          };

          // Phase 2: 旧スマートプラスキャンペーンの登録経路を生成
          if (advertiserId && campaign.advertiser?.appeal) {
            try {
              // キャンペーン配下の広告を取得（AdGroup経由）
              const campaignAds = await this.prisma.ad.findMany({
                where: {
                  adGroup: {
                    campaignId: campaign.id
                  }
                },
                select: { name: true },
              });

              // 全広告がCR名（拡張子含む）かどうかをチェック
              const allAdsHaveCreativeNames =
                campaignAds.length > 0 &&
                campaignAds.every((ad) => this.isCreativeName(ad.name));

              // 手動広告名を持つ広告が1つでもあれば通常キャンペーン
              const hasManualAdNames = campaignAds.some(
                (ad) => ad.name && ad.name.trim() !== '' && !this.isCreativeName(ad.name),
              );

              // 旧スマプラ判定: 全広告がCR名 かつ 手動広告名がない
              if (allAdsHaveCreativeNames && !hasManualAdNames) {
                // キャンペーン名をパース
                const parsedName = this.parseAdName(campaign.name);

                if (parsedName) {
                  // 登録経路を生成
                  const registrationPath = this.generateRegistrationPath(
                    parsedName.lpName,
                    campaign.advertiser.appeal.name,
                  );

                  metricData.registrationPath = registrationPath;

                  this.logger.log(
                    `Smart+ legacy campaign detected: ${campaign.name} -> ${registrationPath}`,
                  );
                }
              }
            } catch (error) {
              this.logger.warn(
                `Failed to determine registration path for campaign ${campaign.id}: ${error.message}`,
              );
              // エラーが発生してもメトリクス保存は継続
            }
          }

          // トランザクションで削除と作成を実行（データ消失防止）
          await this.prisma.$transaction(async (tx) => {
            // 既存のメトリクスを削除（重複防止）
            await tx.metric.deleteMany({
              where: {
                entityType: 'CAMPAIGN',
                campaignId: campaign.id,
                statDate: statDate,
              },
            });

            // 新しいメトリクスを作成
            await tx.metric.create({
              data: metricData,
            });
          });
        }
      }

      this.logger.log(`Successfully saved ${reportData.length} ${dataLevel} metrics`);
    } catch (error) {
      this.logger.error(`Failed to save ${dataLevel} metrics to database`, error);
      throw error;
    }
  }

  /**
   * Pixel一覧を取得
   * GET /v1.3/pixel/list/
   */
  async getPixels(advertiserId: string, accessToken: string) {
    try {
      this.logger.log(`Fetching pixels for advertiser: ${advertiserId}`);

      const response = await this.httpClient.get('/v1.3/pixel/list/', {
        headers: {
          'Access-Token': accessToken,
        },
        params: {
          advertiser_id: advertiserId,
        },
      });

      this.logger.log(`Retrieved ${response.data.data?.pixels||[]?.length || 0} pixels`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get pixels');
      this.logger.error(`Error details: ${JSON.stringify({
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        code: error.code,
      })}`);
      throw error;
    }
  }

  /**
   * Upgraded Smart+ 広告一覧を取得
   * GET /v1.3/smart_plus/ad/get/
   * リトライ対応: タイムアウト、レート制限、サーバーエラー時に自動リトライ
   */
  async getSmartPlusAds(advertiserId: string, accessToken: string, smartPlusAdIds?: string[], operationStatus?: string) {
    try {
      this.logger.log(`Fetching Smart+ ads for advertiser: ${advertiserId}`);

      const params: any = {
        advertiser_id: advertiserId,
        page_size: 100, // 最大値
      };

      const filtering: any = {};
      if (smartPlusAdIds && smartPlusAdIds.length > 0) {
        filtering.smart_plus_ad_ids = smartPlusAdIds;
      }
      if (operationStatus) {
        filtering.operation_status = operationStatus;
      }
      if (Object.keys(filtering).length > 0) {
        params.filtering = JSON.stringify(filtering);
      }

      this.logger.log(`Request params: ${JSON.stringify(params)}`);

      const response = await this.httpGetWithRetry('/v1.3/smart_plus/ad/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params,
      }, 'getSmartPlusAds');

      this.logger.log(`Retrieved ${response.data.data?.list?.length || 0} Smart+ ads`);
      return response.data;
    } catch (error) {
      this.handleTikTokError(error, 'getSmartPlusAds');
    }
  }

  /**
   * 全Smart+ Ad一覧を取得（ページネーション対応）
   * GET /v1.3/smart_plus/ad/get/
   * リトライ対応: 各ページ取得時に自動リトライ
   */
  async getAllSmartPlusAds(advertiserId: string, accessToken: string) {
    const allData: any[] = [];
    let currentPage = 1;
    const pageSize = 100;
    let hasMorePages = true;

    this.logger.log(`Fetching all Smart+ ads for advertiser: ${advertiserId}`);

    while (hasMorePages) {
      try {
        const response = await this.httpGetWithRetry('/v1.3/smart_plus/ad/get/', {
          headers: {
            'Access-Token': accessToken,
          },
          params: {
            advertiser_id: advertiserId,
            page_size: pageSize,
            page: currentPage,
          },
        }, `getAllSmartPlusAds(page=${currentPage})`);

        const list = response.data.data?.list || [];
        if (list.length > 0) {
          allData.push(...list);

          const totalNumber = response.data.data?.page_info?.total_number || 0;
          const totalPages = Math.ceil(totalNumber / pageSize);

          if (currentPage >= totalPages) {
            hasMorePages = false;
          } else {
            currentPage++;
          }
        } else {
          hasMorePages = false;
        }
      } catch (error) {
        this.handleTikTokError(error, `getAllSmartPlusAds(page=${currentPage})`);
      }
    }

    this.logger.log(`Fetched total ${allData.length} Smart+ ads across ${currentPage} pages`);
    return allData;
  }

  /**
   * 単一 Smart+ Ad取得
   * GET /v1.3/smart_plus/ad/get/
   */
  async getSmartPlusAd(advertiserId: string, accessToken: string, smartPlusAdId: string) {
    try {
      this.logger.log(`Fetching Smart+ ad: ${smartPlusAdId}`);

      const response = await this.httpClient.get('/v1.3/smart_plus/ad/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params: {
          advertiser_id: advertiserId,
          filtering: JSON.stringify({
            smart_plus_ad_ids: [smartPlusAdId],
          }),
        },
      });

      const ads = response.data.data?.list || [];
      if (ads.length === 0) {
        throw new Error(`Smart+ ad not found: ${smartPlusAdId}`);
      }

      this.logger.log(`Smart+ ad fetched successfully: ${JSON.stringify(ads[0])}`);
      return ads[0];
    } catch (error) {
      this.logger.error('Failed to get Smart+ ad', error.response?.data || error.message);
      throw error;
    }
  }

  // ============================================================================
  // 旧スマートプラスキャンペーン判定用のヘルパー関数
  // ============================================================================

  /**
   * 広告名がクリエイティブ名（拡張子含む）かどうかを判定
   * @param adName 広告名
   * @returns CR名の場合true
   */
  private isCreativeName(adName: string | null | undefined): boolean {
    if (!adName) return false;

    const videoExtensions = ['.mp4', '.MP4', '.mov', '.MOV', '.avi', '.AVI'];
    const imageExtensions = ['.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.gif', '.GIF'];
    const allExtensions = [...videoExtensions, ...imageExtensions];

    return allExtensions.some((ext) => adName.includes(ext));
  }

  /**
   * 広告名/キャンペーン名をパース
   * 形式: 出稿日/制作者名/CR名/LP名-番号
   * @param name 広告名またはキャンペーン名
   * @returns パース結果（失敗時はnull）
   */
  private parseAdName(name: string): { date: string; creator: string; creativeName: string; lpName: string } | null {
    const parts = name.split('/');

    // 最低4パート必要（出稿日/制作者名/CR名/LP名）
    if (parts.length < 4) {
      return null;
    }

    // 最初のパート: 出稿日
    const date = parts[0];

    // 2番目のパート: 制作者名
    const creator = parts[1];

    // 最後のパート: LP名-番号
    const lpName = parts[parts.length - 1];

    // 3番目から最後の手前まで: CR名（複数パートの場合は "/" で結合）
    const creativeName = parts.slice(2, parts.length - 1).join('/');

    return {
      date,
      creator,
      creativeName,
      lpName,
    };
  }

  /**
   * 登録経路を生成
   * @param lpName LP名-番号
   * @param appealName 訴求名
   * @returns 登録経路（形式: TikTok広告-訴求-LP名および番号）
   */
  private generateRegistrationPath(lpName: string, appealName: string): string {
    return `TikTok広告-${appealName}-${lpName}`;
  }

  /**
   * Smart+広告のメトリクスを取得
   * GET /v1.3/smart_plus/material_report/overview/
   */
  async getSmartPlusAdMetrics(
    advertiserId: string,
    accessToken: string,
    options: {
      startDate: string;
      endDate: string;
      smartPlusAdIds?: string[];
      metrics?: string[];
    },
  ) {
    try {
      const {
        startDate,
        endDate,
        smartPlusAdIds,
        metrics = [
          'impressions',
          'clicks',
          'spend',
          'ctr',
          'cpc',
          'cpm',
          'conversion',
          'cost_per_conversion',
          'video_watched_2s',
          'video_watched_6s',
        ],
      } = options;

      this.logger.log(`Fetching Smart+ ad metrics for advertiser: ${advertiserId}, period: ${startDate} ~ ${endDate}`);

      const params: any = {
        advertiser_id: advertiserId,
        dimensions: JSON.stringify(['smart_plus_ad_id', 'main_material_id']),
        metrics: JSON.stringify(metrics),
        start_date: startDate,
        end_date: endDate,
        page: 1,
        page_size: 100,
      };

      // 特定のSmart+広告IDでフィルタする場合
      if (smartPlusAdIds && smartPlusAdIds.length > 0) {
        params.filtering = JSON.stringify({
          smart_plus_ad_ids: smartPlusAdIds,
        });
      }

      const response = await this.httpClient.get('/v1.3/smart_plus/material_report/overview/', {
        headers: {
          'Access-Token': accessToken,
        },
        params,
      });

      this.logger.log(`Retrieved Smart+ metrics data: ${response.data.data?.list?.length || 0} records`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get Smart+ ad metrics');
      this.logger.error(`Error details: ${JSON.stringify({
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        code: error.code,
      })}`);
      throw error;
    }
  }

  /**
   * 全ページのSmart+メトリクスデータを取得
   */
  async getAllSmartPlusAdMetrics(
    advertiserId: string,
    accessToken: string,
    options: {
      startDate: string;
      endDate: string;
      smartPlusAdIds?: string[];
      metrics?: string[];
    },
  ) {
    const allData: any[] = [];
    let currentPage = 1;
    const pageSize = 100;
    let hasMorePages = true;

    this.logger.log(`Fetching all Smart+ ad metrics for advertiser: ${advertiserId}`);

    while (hasMorePages) {
      const params: any = {
        advertiser_id: advertiserId,
        dimensions: JSON.stringify(['smart_plus_ad_id', 'main_material_id']),
        metrics: JSON.stringify(options.metrics || [
          'impressions',
          'clicks',
          'spend',
          'ctr',
          'cpc',
          'cpm',
          'conversion',
          'cost_per_conversion',
          'video_watched_2s',
          'video_watched_6s',
        ]),
        start_date: options.startDate,
        end_date: options.endDate,
        page: currentPage,
        page_size: pageSize,
      };

      if (options.smartPlusAdIds && options.smartPlusAdIds.length > 0) {
        params.filtering = JSON.stringify({
          smart_plus_ad_ids: options.smartPlusAdIds,
        });
      }

      const response = await this.httpClient.get('/v1.3/smart_plus/material_report/overview/', {
        headers: {
          'Access-Token': accessToken,
        },
        params,
      });

      if (response.data.data?.list && response.data.data.list.length > 0) {
        allData.push(...response.data.data.list);

        const totalPages = Math.ceil((response.data.data.page_info?.total_number || 0) / pageSize);

        if (currentPage >= totalPages) {
          hasMorePages = false;
        } else {
          currentPage++;
        }
      } else {
        hasMorePages = false;
      }
    }

    this.logger.log(`Fetched total ${allData.length} Smart+ metric records across ${currentPage} pages`);
    return allData;
  }

  /**
   * Smart+広告のメトリクスをDBに保存
   * Smart+のAPIはクリエイティブごとにメトリクスを返すため、広告IDごとに集計してから保存
   */
  async saveSmartPlusMetrics(
    metricsData: any[],
    advertiserId: string,
  ) {
    try {
      this.logger.log(`Processing ${metricsData.length} Smart+ ad metric records`);

      // ステップ1: smart_plus_ad_idごとにメトリクスを集計
      const adMetricsMap = new Map<string, {
        impressions: number;
        clicks: number;
        spend: number;
        conversions: number;
        ctr: number;
        cpc: number;
        cpm: number;
        cpa: number;
        videoViews: number;
        videoWatched2s: number;
        videoWatched6s: number;
        creativeCount: number;
      }>();

      for (const record of metricsData) {
        const smartPlusAdId = record.dimensions?.smart_plus_ad_id;
        const metrics = record.metrics || {};

        if (!smartPlusAdId) {
          this.logger.warn('Skipping Smart+ metric record without smart_plus_ad_id');
          continue;
        }

        if (!adMetricsMap.has(smartPlusAdId)) {
          adMetricsMap.set(smartPlusAdId, {
            impressions: 0,
            clicks: 0,
            spend: 0,
            conversions: 0,
            ctr: 0,
            cpc: 0,
            cpm: 0,
            cpa: 0,
            videoViews: 0,
            videoWatched2s: 0,
            videoWatched6s: 0,
            creativeCount: 0,
          });
        }

        const aggregated = adMetricsMap.get(smartPlusAdId)!;

        // 各クリエイティブのメトリクスを合計
        aggregated.impressions += parseInt(metrics.impressions || '0', 10);
        aggregated.clicks += parseInt(metrics.clicks || '0', 10);
        aggregated.spend += parseFloat(metrics.spend || '0');
        aggregated.conversions += parseInt(metrics.conversion || '0', 10);
        aggregated.videoViews += parseInt(metrics.video_views || '0', 10);
        aggregated.videoWatched2s += parseInt(metrics.video_watched_2s || '0', 10);
        aggregated.videoWatched6s += parseInt(metrics.video_watched_6s || '0', 10);
        aggregated.creativeCount += 1;
      }

      this.logger.log(`Aggregated metrics for ${adMetricsMap.size} Smart+ ads`);

      // ステップ2: 統計日時を計算（昨日）- JST基準でUTC 00:00:00形式
      const yesterday = getYesterdayJST();

      // ステップ3: 各広告の集計メトリクスをDBに保存
      let savedCount = 0;
      for (const [smartPlusAdId, aggregated] of adMetricsMap.entries()) {
        // DBのAdレコードを検索（tiktokId = smart_plus_ad_id）
        const ad = await this.prisma.ad.findUnique({
          where: { tiktokId: String(smartPlusAdId) },
        });

        if (!ad) {
          this.logger.warn(`Smart+ ad not found in DB: ${smartPlusAdId}`);
          continue;
        }

        this.logger.debug(`Processing Smart+ ad ${smartPlusAdId}: ${aggregated.creativeCount} creatives, ${aggregated.impressions} impressions, ${aggregated.spend} spend`);

        // 平均値を計算（CTR、CPC、CPMなど）
        const ctr = aggregated.clicks > 0 ? (aggregated.clicks / aggregated.impressions) * 100 : 0;
        const cpc = aggregated.clicks > 0 ? aggregated.spend / aggregated.clicks : 0;
        const cpm = aggregated.impressions > 0 ? (aggregated.spend / aggregated.impressions) * 1000 : 0;
        const cpa = aggregated.conversions > 0 ? aggregated.spend / aggregated.conversions : 0;

        const metricData = {
          entityType: 'AD' as const,
          adId: ad.id,
          statDate: yesterday,
          impressions: aggregated.impressions,
          clicks: aggregated.clicks,
          spend: aggregated.spend,
          conversions: aggregated.conversions,
          ctr: ctr,
          cpc: cpc,
          cpm: cpm,
          cpa: cpa,
          videoViews: aggregated.videoViews,
          videoWatched2s: aggregated.videoWatched2s,
          videoWatched6s: aggregated.videoWatched6s,
        };

        // トランザクションで削除と作成を実行（データ消失防止）
        await this.prisma.$transaction(async (tx) => {
          // 既存のメトリクスを削除してから新しいデータを挿入（上書き）
          await tx.metric.deleteMany({
            where: {
              entityType: 'AD',
              adId: ad.id,
              statDate: yesterday,
            },
          });

          await tx.metric.create({
            data: metricData,
          });
        });

        this.logger.debug(`Saved aggregated metrics for Smart+ ad ${smartPlusAdId} (${aggregated.creativeCount} creatives)`);
        savedCount++;
      }

      this.logger.log(`Successfully saved metrics for ${savedCount} Smart+ ads`);
    } catch (error) {
      this.logger.error('Failed to save Smart+ metrics to database', error);
      throw error;
    }
  }

  // ============================================================================
  // Upgraded Smart+ 予算更新 API
  // ============================================================================

  /**
   * Upgraded Smart+ 広告セットの予算を更新
   * POST /v1.3/smart_plus/adgroup/budget/update/
   *
   * @param advertiserId 広告主ID
   * @param accessToken アクセストークン
   * @param budgetUpdates 予算更新情報の配列（最大20件）
   */
  async updateSmartPlusAdGroupBudgets(
    advertiserId: string,
    accessToken: string,
    budgetUpdates: Array<{ adgroup_id: string; budget: number }>,
  ) {
    try {
      this.logger.log(`Updating Smart+ adgroup budgets for advertiser: ${advertiserId}`);
      this.logger.log(`Budget updates: ${JSON.stringify(budgetUpdates)}`);

      if (budgetUpdates.length === 0) {
        this.logger.warn('No budget updates provided');
        return { code: 0, message: 'No updates', data: {} };
      }

      if (budgetUpdates.length > 20) {
        throw new Error('Maximum 20 adgroup budget updates allowed per request');
      }

      const requestBody = {
        advertiser_id: advertiserId,
        budget: budgetUpdates,
      };

      // M-01: リトライ対応に変更
      const response = await this.httpPostWithRetry(
        '/v1.3/smart_plus/adgroup/budget/update/',
        requestBody,
        {
          headers: {
            'Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        },
        'updateSmartPlusAdGroupBudgets',
      );

      this.logger.log(`Smart+ adgroup budget update response: ${JSON.stringify(response.data)}`);

      if (response.data.code !== 0) {
        const error = new Error(`TikTok API error: ${response.data.message}`);
        this.logger.error('Failed to update Smart+ adgroup budgets', response.data);
        throw error;
      }

      this.logger.log('Smart+ adgroup budgets updated successfully');
      return response.data;
    } catch (error) {
      this.logger.error('Failed to update Smart+ adgroup budgets');
      this.logger.error(`Error details: ${JSON.stringify({
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        code: error.code,
      })}`);
      throw error;
    }
  }

  /**
   * Upgraded Smart+ キャンペーンの予算を更新
   * POST /v1.3/smart_plus/campaign/update/
   *
   * @param advertiserId 広告主ID
   * @param accessToken アクセストークン
   * @param campaignId キャンペーンID
   * @param budget 新しい予算
   */
  async updateSmartPlusCampaignBudget(
    advertiserId: string,
    accessToken: string,
    campaignId: string,
    budget: number,
  ) {
    try {
      this.logger.log(`Updating Smart+ campaign budget: campaignId=${campaignId}, budget=${budget}`);

      const requestBody = {
        advertiser_id: advertiserId,
        campaign_id: campaignId,
        budget: budget,
      };

      const response = await this.httpClient.post(
        '/v1.3/smart_plus/campaign/update/',
        requestBody,
        {
          headers: {
            'Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(`Smart+ campaign budget update response: ${JSON.stringify(response.data)}`);

      if (response.data.code !== 0) {
        const error = new Error(`TikTok API error: ${response.data.message}`);
        this.logger.error('Failed to update Smart+ campaign budget', response.data);
        throw error;
      }

      this.logger.log('Smart+ campaign budget updated successfully');
      return response.data;
    } catch (error) {
      this.logger.error('Failed to update Smart+ campaign budget');
      this.logger.error(`Error details: ${JSON.stringify({
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        code: error.code,
      })}`);
      throw error;
    }
  }

  // ============================================================================
  // 横展開用メソッド: 動画情報取得・ダウンロード・アップロード
  // ============================================================================

  /**
   * 動画のメタ情報を取得（preview_url含む）
   * GET /v1.3/file/video/ad/info/
   */
  async getVideoInfo(
    advertiserId: string,
    accessToken: string,
    videoIds: string[],
  ): Promise<any[]> {
    try {
      this.logger.log(`動画情報取得: ${videoIds.length}本 (advertiser: ${advertiserId})`);

      const response = await this.httpGetWithRetry(
        '/v1.3/file/video/ad/info/',
        {
          headers: { 'Access-Token': accessToken },
          params: {
            advertiser_id: advertiserId,
            video_ids: JSON.stringify(videoIds),
          },
        },
        'getVideoInfo',
      );

      // レスポンスはdata.listまたはdata（配列）の場合がある
      const data = response.data.data;
      const videos = data?.list || (Array.isArray(data) ? data : []);
      this.logger.log(`動画情報取得完了: ${videos.length}本`);
      return videos;
    } catch (error) {
      this.logger.error('動画情報取得失敗', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * URLから動画をダウンロード（Bufferに保持）
   */
  async downloadVideo(videoUrl: string): Promise<Buffer> {
    try {
      this.logger.log(`動画ダウンロード中: ${videoUrl.substring(0, 80)}...`);

      const response = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        timeout: 120000, // 動画は大きいので2分タイムアウト
      });

      const buffer = Buffer.from(response.data);
      this.logger.log(`動画ダウンロード完了: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
      return buffer;
    } catch (error) {
      this.logger.error('動画ダウンロード失敗', error.message);
      throw error;
    }
  }

  /**
   * 動画を指定アカウントにアップロード
   * POST /v1.3/file/video/ad/upload/
   * @returns 新しいvideo_id
   */
  async uploadVideoToAccount(
    advertiserId: string,
    accessToken: string,
    videoBuffer: Buffer,
    filename: string,
  ): Promise<string> {
    try {
      this.logger.log(`動画アップロード中: ${filename} → advertiser ${advertiserId}`);

      const md5Hash = createHash('md5').update(videoBuffer).digest('hex');

      const formData = new FormData();
      formData.append('advertiser_id', advertiserId);
      formData.append('upload_type', 'UPLOAD_BY_FILE');
      formData.append('video_signature', md5Hash);
      const uniqueFilename = `${Date.now()}_${filename}`;
      formData.append('video_file', videoBuffer, {
        filename: uniqueFilename,
        contentType: 'video/mp4',
      });

      const response = await this.httpClient.post(
        '/v1.3/file/video/ad/upload/',
        formData,
        {
          headers: {
            'Access-Token': accessToken,
            ...formData.getHeaders(),
          },
          timeout: 300000, // アップロードは時間がかかる（79MBで2分以上）
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        },
      );

      if (response.data.code !== 0) {
        throw new Error(`動画アップロード失敗: ${response.data.message}`);
      }

      // レスポンスが配列の場合（data: [{ video_id, ... }]）
      const data = response.data.data;
      const newVideoId = Array.isArray(data) ? data[0]?.video_id : data?.video_id;
      if (!newVideoId) {
        throw new Error('動画アップロード: video_idが返されませんでした');
      }

      this.logger.log(`動画アップロード完了: ${newVideoId}`);
      return newVideoId;
    } catch (error) {
      this.logger.error('動画アップロード失敗', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * アップロードした動画の処理完了を待つ
   * @returns 処理完了した動画情報
   */
  async waitForVideoReady(
    advertiserId: string,
    accessToken: string,
    videoId: string,
    maxRetries = 5,
  ): Promise<any> {
    let delay = 3000; // 初回3秒待機
    for (let i = 0; i < maxRetries; i++) {
      await new Promise(r => setTimeout(r, delay));
      delay = Math.floor(delay * 1.5); // 指数バックオフ

      const videos = await this.getVideoInfo(advertiserId, accessToken, [videoId]);
      if (videos.length > 0) {
        const video = videos[0];
        // 処理完了チェック: poster_url(サムネイル)が生成されていればOK
        if (video.poster_url || video.video_cover_url) {
          this.logger.log(`動画処理完了: ${videoId}`);
          return video;
        }
      }
      this.logger.log(`動画処理待ち (${i + 1}/${maxRetries}): ${videoId}`);
    }
    this.logger.warn(`動画処理タイムアウト: ${videoId}（アップロードは成功済み、処理中の可能性）`);
    return null;
  }

  /**
   * 画像をアカウントにアップロード（サムネイル用）
   * POST /v1.3/file/image/ad/upload/
   * @returns image_id
   */
  async uploadImageToAccount(
    advertiserId: string,
    accessToken: string,
    imageBuffer: Buffer,
    filename: string,
  ): Promise<string> {
    try {
      this.logger.log(`画像アップロード中: ${filename} → advertiser ${advertiserId}`);

      const md5Hash = createHash('md5').update(imageBuffer).digest('hex');

      const formData = new FormData();
      formData.append('advertiser_id', advertiserId);
      formData.append('upload_type', 'UPLOAD_BY_FILE');
      formData.append('image_signature', md5Hash);
      formData.append('image_file', imageBuffer, {
        filename: `${Date.now()}_${filename}`,
        contentType: 'image/jpeg',
      });

      const response = await this.httpClient.post(
        '/v1.3/file/image/ad/upload/',
        formData,
        {
          headers: {
            'Access-Token': accessToken,
            ...formData.getHeaders(),
          },
          timeout: 30000,
        },
      );

      if (response.data.code !== 0) {
        throw new Error(`画像アップロード失敗: ${response.data.message}`);
      }

      const imageId = response.data.data?.image_id;
      if (!imageId) {
        throw new Error('画像アップロード: image_idが返されませんでした');
      }

      this.logger.log(`画像アップロード完了: ${imageId}`);
      return imageId;
    } catch (error) {
      this.logger.error('画像アップロード失敗', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 動画のカバー画像をダウンロードしてアップロード（サムネイル取得用）
   * @returns image_id
   */
  async uploadVideoThumbnail(
    advertiserId: string,
    accessToken: string,
    videoId: string,
  ): Promise<string> {
    // 動画情報からcover_urlを取得（リトライあり: TikTok側の処理完了を待つ）
    let coverUrl: string | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      const videos = await this.getVideoInfo(advertiserId, accessToken, [videoId]);
      coverUrl = videos[0]?.video_cover_url || videos[0]?.poster_url;
      if (coverUrl) break;
      this.logger.log(`カバー画像URL待ち (${attempt + 1}/6): ${videoId}`);
      await new Promise(r => setTimeout(r, 5000 * (attempt + 1))); // 5s, 10s, 15s...
    }
    if (!coverUrl) {
      throw new Error(`動画 ${videoId} のカバー画像URLが取得できません（6回リトライ後）`);
    }

    // カバー画像をダウンロード
    const coverResp = await axios.get(coverUrl, { responseType: 'arraybuffer', timeout: 30000 });
    const coverBuffer = Buffer.from(coverResp.data);

    // アップロード
    return this.uploadImageToAccount(advertiserId, accessToken, coverBuffer, `thumb_${videoId}.jpg`);
  }

  /**
   * 画像情報を取得（image_id/web_uri → image_url）
   * GET /v1.3/file/image/ad/info/
   */
  async getImageInfo(
    advertiserId: string,
    accessToken: string,
    imageIds: string[],
  ): Promise<any[]> {
    try {
      const response = await this.httpGetWithRetry(
        '/v1.3/file/image/ad/info/',
        {
          headers: { 'Access-Token': accessToken },
          params: {
            advertiser_id: advertiserId,
            image_ids: JSON.stringify(imageIds),
          },
        },
        'getImageInfo',
      );

      if (response.data.code !== 0) {
        throw new Error(`画像情報取得失敗: ${response.data.message}`);
      }

      return response.data.data?.list || [];
    } catch (error) {
      this.logger.error('画像情報取得失敗', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * カスタムオーディエンス一覧取得
   * GET /v1.3/dmp/custom_audience/list/
   */
  async getCustomAudiences(
    advertiserId: string,
    accessToken: string,
  ): Promise<any[]> {
    try {
      this.logger.log(`カスタムオーディエンス取得: ${advertiserId}`);

      const response = await this.httpClient.get('/v1.3/dmp/custom_audience/list/', {
        headers: { 'Access-Token': accessToken },
        params: {
          advertiser_id: advertiserId,
          page_size: 100,
        },
      });

      if (response.data.code !== 0) {
        throw new Error(`カスタムオーディエンス取得失敗: ${response.data.message}`);
      }

      const audiences = response.data.data?.list || [];
      this.logger.log(`カスタムオーディエンス取得完了: ${audiences.length}件`);
      return audiences;
    } catch (error) {
      this.logger.error('カスタムオーディエンス取得失敗', error.response?.data || error.message);
      throw error;
    }
  }

  // ============================================================================
  // 横展開用メソッド: Smart+広告作成
  // ============================================================================

  /**
   * Smart+広告の完全データ取得（video_id解決含む）
   * creative_listからvideo_idを取得し、取れない場合はDBフォールバック
   */
  async getSmartPlusAdFullDetail(
    advertiserId: string,
    accessToken: string,
    smartPlusAdId: string,
  ): Promise<{
    ad: any;
    videoIds: string[];
    imageIds: string[];
    adFormat: string;
    adTexts: string[];
    landingPageUrls: string[];
    adName: string;
    adConfiguration: any;
  }> {
    // Smart+広告データを取得
    const ad = await this.getSmartPlusAd(advertiserId, accessToken, smartPlusAdId);

    // creative_listからad_formatを判定
    const creativeList = ad.creative_list || [];
    let adFormat = 'SINGLE_VIDEO';
    if (creativeList.length > 0) {
      adFormat = creativeList[0]?.creative_info?.ad_format || 'SINGLE_VIDEO';
    }

    // video_id / image_id を抽出
    let videoIds: string[] = [];
    let imageIds: string[] = [];

    for (const creative of creativeList) {
      const ci = creative?.creative_info;
      if (ci?.ad_format === 'CAROUSEL_ADS') {
        // カルーセル（画像）広告
        const imgs = ci?.image_info || [];
        for (const img of imgs) {
          if (img.web_uri) imageIds.push(img.web_uri);
        }
      } else {
        // 動画広告
        const videoId = ci?.video_info?.video_id;
        if (videoId && videoId !== 'N/A') {
          videoIds.push(videoId);
        }
      }
    }

    // video_idが取れない場合、通常のad/getでフォールバック
    if (videoIds.length === 0) {
      this.logger.warn('Smart+のcreative_listからvideo_id取得失敗、ad/getでフォールバック');
      try {
        const adResp = await this.httpGetWithRetry(
          '/v1.3/ad/get/',
          {
            headers: { 'Access-Token': accessToken },
            params: {
              advertiser_id: advertiserId,
              filtering: JSON.stringify({ ad_ids: [smartPlusAdId] }),
              fields: JSON.stringify(['ad_id', 'video_id', 'ad_name']),
            },
          },
          'getAdForVideoId',
        );
        const regularAds = adResp.data.data?.list || [];
        for (const regularAd of regularAds) {
          if (regularAd.video_id) videoIds.push(regularAd.video_id);
        }
      } catch (e) {
        this.logger.warn('ad/getフォールバックも失敗');
      }
    }

    // それでも取れない場合、DBのCreativeテーブルからフォールバック
    if (videoIds.length === 0) {
      this.logger.warn('APIからvideo_id取得失敗、DBからフォールバック');
      const dbCreatives = await this.prisma.creative.findMany({
        where: {
          ads: {
            some: {
              adGroup: {
                campaign: {
                  advertiser: { tiktokAdvertiserId: advertiserId },
                },
              },
            },
          },
          tiktokVideoId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      videoIds = dbCreatives.map(c => c.tiktokVideoId!).filter(Boolean);
    }

    // 広告文を抽出
    const adTexts: string[] = (ad.ad_text_list || []).map((t: any) => t.ad_text).filter(Boolean);

    // LP URLを抽出
    const landingPageUrls: string[] = (ad.landing_page_url_list || [])
      .map((l: any) => l.landing_page_url)
      .filter(Boolean);

    return {
      ad,
      videoIds,
      imageIds,
      adFormat,
      adTexts,
      landingPageUrls,
      adName: ad.ad_name || '',
      adConfiguration: ad.ad_configuration || {},
    };
  }

  /**
   * Smart+キャンペーン作成
   * POST /v1.3/smart_plus/campaign/create/
   */
  async createSmartPlusCampaign(
    advertiserId: string,
    accessToken: string,
    params: {
      campaignName: string;
      objectiveType?: string;
      budgetMode?: string;
      budgetOptimizeOn?: boolean;
    },
  ): Promise<string> {
    try {
      this.logger.log(`Smart+キャンペーン作成: ${params.campaignName}`);

      const { v4: uuidv4 } = await import('uuid');

      const requestBody = {
        advertiser_id: advertiserId,
        campaign_name: params.campaignName,
        objective_type: params.objectiveType || 'LEAD_GENERATION',
        budget_mode: params.budgetMode || 'BUDGET_MODE_INFINITE',
        budget_optimize_on: params.budgetOptimizeOn ?? false,
        request_id: uuidv4(),
      };

      const response = await this.httpPostWithRetry(
        '/v1.3/smart_plus/campaign/create/',
        requestBody,
        { headers: { 'Access-Token': accessToken } },
        'createSmartPlusCampaign',
      );

      if (response.data.code !== 0) {
        throw new Error(`Smart+キャンペーン作成失敗: ${response.data.message}`);
      }

      const campaignId = response.data.data?.campaign_id;
      if (!campaignId) {
        throw new Error('Smart+キャンペーン作成: campaign_idが返されませんでした');
      }

      this.logger.log(`Smart+キャンペーン作成完了: ${campaignId}`);
      return String(campaignId);
    } catch (error) {
      this.logger.error('Smart+キャンペーン作成失敗', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Smart+広告グループ作成
   * POST /v1.3/smart_plus/adgroup/create/
   */
  async createSmartPlusAdGroup(
    advertiserId: string,
    accessToken: string,
    params: {
      campaignId: string;
      adgroupName: string;
      budget: number;
      pixelId: string;
      scheduleStartTime?: string;
    },
  ): Promise<string> {
    try {
      this.logger.log(`Smart+広告グループ作成: ${params.adgroupName}`);

      const requestBody: any = {
        advertiser_id: advertiserId,
        campaign_id: params.campaignId,
        adgroup_name: params.adgroupName,
        budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
        budget: params.budget,
        billing_event: 'OCPM',
        bid_type: 'BID_TYPE_NO_BID',
        optimization_goal: 'CONVERT',
        optimization_event: 'ON_WEB_REGISTER',
        pixel_id: params.pixelId,
        schedule_type: 'SCHEDULE_FROM_NOW',
        schedule_start_time: params.scheduleStartTime || this.getScheduleStartTime(),
        targeting_spec: {
          location_ids: ['1861060'], // 日本
        },
        promotion_type: 'LEAD_GENERATION',
        promotion_target_type: 'EXTERNAL_WEBSITE',
        request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
      };

      const response = await this.httpPostWithRetry(
        '/v1.3/smart_plus/adgroup/create/',
        requestBody,
        { headers: { 'Access-Token': accessToken } },
        'createSmartPlusAdGroup',
      );

      if (response.data.code !== 0) {
        throw new Error(`Smart+広告グループ作成失敗: ${response.data.message}`);
      }

      const adgroupId = response.data.data?.adgroup_id;
      if (!adgroupId) {
        throw new Error('Smart+広告グループ作成: adgroup_idが返されませんでした');
      }

      this.logger.log(`Smart+広告グループ作成完了: ${adgroupId}`);
      return String(adgroupId);
    } catch (error) {
      this.logger.error('Smart+広告グループ作成失敗', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Smart+広告作成
   * POST /v1.3/smart_plus/ad/create/
   */
  async createSmartPlusAd(
    advertiserId: string,
    accessToken: string,
    params: {
      adgroupId: string;
      adName: string;
      creativeList: Array<{
        videoId?: string;
        imageId?: string;
        identityId: string;
        identityType?: string;
        identityAuthorizedBcId?: string;
      }>;
      adTextList: string[];
      landingPageUrls: string[];
      callToActionId?: string;
      operationStatus?: string;
    },
  ): Promise<string> {
    try {
      const videoCount = params.creativeList.filter(c => c.videoId).length;
      const imageCount = params.creativeList.filter(c => c.imageId).length;
      this.logger.log(`Smart+広告作成: ${params.adName} (動画${videoCount}本 + 画像${imageCount}枚)`);

      const requestBody: any = {
        advertiser_id: advertiserId,
        adgroup_id: params.adgroupId,
        ad_name: params.adName,
        creative_list: params.creativeList.map(c => {
          if (c.imageId) {
            // カルーセル（画像）広告
            return {
              creative_info: {
                ad_format: 'CAROUSEL_ADS',
                image_info: [{ web_uri: c.imageId }],
                identity_id: c.identityId,
                identity_type: c.identityType || 'BC_AUTH_TT',
                identity_authorized_bc_id: c.identityAuthorizedBcId,
                music_info: { music_id: '6954068488952498177' },
              },
            };
          }
          // 動画広告
          return {
            creative_info: {
              ad_format: 'SINGLE_VIDEO',
              video_info: { video_id: c.videoId },
              identity_id: c.identityId,
              identity_type: c.identityType || 'BC_AUTH_TT',
              identity_authorized_bc_id: c.identityAuthorizedBcId,
            },
          };
        }),
        ad_text_list: params.adTextList.map(text => ({ ad_text: text })),
        landing_page_url_list: params.landingPageUrls.map(url => ({ landing_page_url: url })),
        operation_status: params.operationStatus || 'ENABLE',
        request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
      };

      // CTA: call_to_action_listではなくad_configurationで渡す
      if (params.callToActionId) {
        requestBody.ad_configuration = { call_to_action_id: params.callToActionId };
      }

      const response = await this.httpPostWithRetry(
        '/v1.3/smart_plus/ad/create/',
        requestBody,
        { headers: { 'Access-Token': accessToken } },
        'createSmartPlusAd',
      );

      if (response.data.code !== 0) {
        throw new Error(`Smart+広告作成失敗: ${response.data.message}`);
      }

      const adId = response.data.data?.ad_id || response.data.data?.smart_plus_ad_id;
      if (!adId) {
        throw new Error('Smart+広告作成: ad_idが返されませんでした');
      }

      this.logger.log(`Smart+広告作成完了: ${adId}`);
      return String(adId);
    } catch (error) {
      this.logger.error('Smart+広告作成失敗', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * JST現在時刻+5分のスケジュール開始時刻を返す
   */
  private getScheduleStartTime(): string {
    // 現在UTC+5分を開始時刻とする（TikTok APIはUTCで解釈する）
    const t = new Date(Date.now() + 5 * 60 * 1000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:${String(t.getUTCSeconds()).padStart(2, '0')}`;
  }
}
