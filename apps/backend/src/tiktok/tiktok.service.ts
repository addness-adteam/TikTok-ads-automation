import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { PrismaService } from '../prisma/prisma.service';

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
      // 24時間後に有効期限を設定
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      const scopeStr = scope ? JSON.stringify(scope) : null;

      // 各Advertiser用にトークンを保存
      for (const advertiserId of advertiserIds) {
        // まずAdvertiserレコードを作成（存在しない場合）
        await this.prisma.advertiser.upsert({
          where: { tiktokAdvertiserId: advertiserId },
          create: {
            tiktokAdvertiserId: advertiserId,
            name: `Advertiser ${advertiserId}`,
          },
          update: {},
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
   * Campaign一覧を取得
   * GET /v1.3/campaign/get/
   */
  async getCampaigns(advertiserId: string, accessToken: string, campaignIds?: string[]) {
    try {
      this.logger.log(`Fetching campaigns for advertiser: ${advertiserId}`);

      const requestBody: any = {
        advertiser_id: advertiserId,
      };

      if (campaignIds && campaignIds.length > 0) {
        requestBody.filtering = {
          campaign_ids: campaignIds,
        };
      }

      const response = await this.httpClient.get('/v1.3/campaign/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params: requestBody,
      });

      this.logger.log(`Retrieved ${response.data.data?.list?.length || 0} campaigns`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get campaigns', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Ad Group（広告セット）一覧を取得
   * GET /v1.3/adgroup/get/
   */
  async getAdGroups(advertiserId: string, accessToken: string, campaignIds?: string[]) {
    try {
      this.logger.log(`Fetching ad groups for advertiser: ${advertiserId}`);

      const requestBody: any = {
        advertiser_id: advertiserId,
        page_size: 1000, // 最大1000件取得
      };

      if (campaignIds && campaignIds.length > 0) {
        requestBody.filtering = {
          campaign_ids: campaignIds,
        };
      }

      const response = await this.httpClient.get('/v1.3/adgroup/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params: requestBody,
      });

      this.logger.log(`Retrieved ${response.data.data?.list?.length || 0} ad groups`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get ad groups', error.response?.data || error.message);
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

      this.logger.log('Campaign created successfully');
      this.logger.log('Campaign data:', JSON.stringify(response.data, null, 2));

      // DBに保存
      if (response.data.data?.campaign_id) {
        await this.prisma.campaign.create({
          data: {
            tiktokId: String(response.data.data.campaign_id),
            advertiserId,
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
        dimensions = ['stat_time_day'],
        metrics = [
          'impressions',
          'clicks',
          'spend',
          'conversions',
          'ctr',
          'cpc',
          'cpm',
          'cost_per_conversion',
          'video_views',
          'video_watched_2s',
          'video_watched_6s',
        ],
        filtering,
        page = 1,
        pageSize = 1000,
      } = options;

      this.logger.log(`Fetching report for advertiser: ${advertiserId}, level: ${dataLevel}, period: ${startDate} ~ ${endDate}`);

      const params: any = {
        advertiser_id: advertiserId,
        data_level: dataLevel,
        dimensions: dimensions,
        metrics: metrics,
        start_date: startDate,
        end_date: endDate,
        page,
        page_size: pageSize,
      };

      if (filtering) {
        params.filtering = filtering;
      }

      const response = await this.httpClient.get('/v1.3/report/integrated/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params,
      });

      this.logger.log(`Retrieved report data: ${response.data.data?.list?.length || 0} records`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get report', error.response?.data || error.message);
      throw error;
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
  ) {
    try {
      this.logger.log(`Saving ${reportData.length} metrics to database`);

      for (const record of reportData) {
        const statDate = new Date(record.dimensions?.stat_time_day || record.stat_time_day);
        const campaignId = record.dimensions?.campaign_id || record.campaign_id;

        if (!campaignId) {
          this.logger.warn('Skipping record without campaign_id');
          continue;
        }

        // DBのCampaignレコードを検索（tiktokIdで）
        const campaign = await this.prisma.campaign.findUnique({
          where: { tiktokId: String(campaignId) },
        });

        if (!campaign) {
          this.logger.warn(`Campaign not found in DB: ${campaignId}`);
          continue;
        }

        const metrics = record.metrics || {};

        // メトリクスをupsert
        await this.prisma.metric.upsert({
          where: {
            metric_campaign_unique: {
              entityType: 'CAMPAIGN',
              campaignId: campaign.id,
              statDate: statDate,
            },
          },
          create: {
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
          },
          update: {
            impressions: parseInt(metrics.impressions || '0', 10),
            clicks: parseInt(metrics.clicks || '0', 10),
            spend: parseFloat(metrics.spend || '0'),
            conversions: parseInt(metrics.conversions || '0', 10),
            ctr: parseFloat(metrics.ctr || '0'),
            cpc: parseFloat(metrics.cpc || '0'),
            cpm: parseFloat(metrics.cpm || '0'),
            cpa: parseFloat(metrics.cost_per_conversion || '0'),
          },
        });
      }

      this.logger.log(`Successfully saved ${reportData.length} metrics`);
    } catch (error) {
      this.logger.error('Failed to save metrics to database', error);
      throw error;
    }
  }
}
