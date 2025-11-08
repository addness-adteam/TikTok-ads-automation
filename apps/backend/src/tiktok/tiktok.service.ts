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
      this.logger.error('Failed to get campaigns');
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
   * Ad Group（広告セット）一覧を取得
   * GET /v1.3/adgroup/get/
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

      const response = await this.httpClient.get('/v1.3/adgroup/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params,
      });

      this.logger.log(`Retrieved ${response.data.data?.list?.length || 0} ad groups`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get ad groups');
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
   * 単一Ad Group取得
   * GET /v1.3/adgroup/get/
   */
  async getAdGroup(advertiserId: string, accessToken: string, adgroupId: string) {
    try {
      this.logger.log(`Fetching adgroup: ${adgroupId}`);

      const response = await this.httpClient.get('/v1.3/adgroup/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params: {
          advertiser_id: advertiserId,
          filtering: {
            adgroup_ids: [adgroupId],
          },
        },
      });

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
   */
  async getAds(advertiserId: string, accessToken: string, adgroupIds?: string[]) {
    try {
      this.logger.log(`Fetching ads for advertiser: ${advertiserId}`);

      const params: any = {
        advertiser_id: advertiserId,
        page_size: 100, // TikTok API v1.3の最大値
      };

      if (adgroupIds && adgroupIds.length > 0) {
        params.filtering = JSON.stringify({
          adgroup_ids: adgroupIds,
        });
      }

      this.logger.log(`Request params: ${JSON.stringify(params)}`);

      const response = await this.httpClient.get('/v1.3/ad/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params,
      });

      this.logger.log(`Retrieved ${response.data.data?.list?.length || 0} ads`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get ads');
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
   * Ad更新
   * POST /v1.2/ad/update/
   */
  async updateAd(
    advertiserId: string,
    accessToken: string,
    adId: string,
    updates: {
      status?: string;
    },
  ) {
    try {
      this.logger.log(`Updating ad: ${adId}`);

      const requestBody: any = {
        advertiser_id: advertiserId,
        ad_id: adId,
      };

      if (updates.status) {
        requestBody.operation_status = updates.status;
      }

      const response = await this.httpClient.post('/v1.2/ad/update/', requestBody, {
        headers: {
          'Access-Token': accessToken,
        },
      });

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
    },
    accessToken: string,
  ) {
    try {
      this.logger.log(`Creating adgroup: ${adgroupName} for campaign: ${campaignId}`);

      const requestBody: any = {
        advertiser_id: advertiserId,
        campaign_id: campaignId,
        adgroup_name: adgroupName,
        placement_type: options.placementType || 'PLACEMENT_TYPE_NORMAL',
        placements: options.placements || ['PLACEMENT_TIKTOK'],
        location_ids: options.targeting?.location_ids || ['6252001'],
        languages: options.targeting?.languages || ['ja'],
        age_groups: options.targeting?.age_groups || ['AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_100'],
        gender: options.targeting?.gender || 'GENDER_UNLIMITED',
        budget_mode: options.budgetMode || 'BUDGET_MODE_DAY',
        budget: options.budget,
        bid_type: options.bidType || 'BID_TYPE_NO_BID',
        optimization_goal: options.optimizationGoal || 'COMPLETE_PAYMENT',
        schedule_type: 'SCHEDULE_START_END',
        schedule_start_time: options.scheduleStartTime,
      };

      if (options.bidPrice) {
        requestBody.bid_price = options.bidPrice;
      }

      if (options.scheduleEndTime) {
        requestBody.schedule_end_time = options.scheduleEndTime;
      }

      if (options.pixelId) {
        requestBody.pixel_id = options.pixelId;
      }

      if (options.optimizationEvent) {
        requestBody.conversion_id = options.optimizationEvent;
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

      const response = await this.httpClient.post('/v1.2/adgroup/create/', requestBody, {
        headers: {
          'Access-Token': accessToken,
        },
      });

      this.logger.log('AdGroup created successfully');
      this.logger.log('AdGroup data:', JSON.stringify(response.data, null, 2));

      // DBに保存
      if (response.data.data?.adgroup_id) {
        await this.prisma.adGroup.create({
          data: {
            tiktokId: String(response.data.data.adgroup_id),
            campaignId,
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

      const requestBody: any = {
        advertiser_id: advertiserId,
        adgroup_id: adgroupId,
        ad_name: adName,
        ad_text: options.adText,
        call_to_action: options.callToAction || 'LEARN_MORE',
        landing_page_url: options.landingPageUrl,
        identity_id: options.identity || 'addness08',
        identity_type: 'TT_USER',
        is_smart_creative: options.creativeAuthorized || false,
      };

      if (options.videoId) {
        requestBody.video_id = options.videoId;
      }

      if (options.imageIds && options.imageIds.length > 0) {
        requestBody.image_ids = options.imageIds;
      }

      if (options.displayMode) {
        requestBody.display_mode = options.displayMode;
      }

      const response = await this.httpClient.post('/v1.2/ad/create/', requestBody, {
        headers: {
          'Access-Token': accessToken,
        },
      });

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
        dimensions = ['stat_time_day'],
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

      this.logger.log(`Fetching report for advertiser: ${advertiserId}, level: ${dataLevel}, period: ${startDate} ~ ${endDate}`);

      const params: any = {
        advertiser_id: advertiserId,
        data_level: dataLevel,
        report_type: 'BASIC',
        dimensions: JSON.stringify(dimensions),
        metrics: JSON.stringify(metrics),
        start_date: startDate,
        end_date: endDate,
        page,
        page_size: pageSize,
      };

      if (filtering) {
        params.filtering = JSON.stringify(filtering);
      }

      const response = await this.httpClient.get('/v1.3/report/integrated/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params,
      });

      this.logger.log(`Retrieved report data: ${response.data.data?.list?.length || 0} records`);
      this.logger.log(`Full API response: ${JSON.stringify(response.data, null, 2)}`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get report');
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
      this.logger.log(`Saving ${reportData.length} ${dataLevel} metrics to database`);

      for (const record of reportData) {
        const statDate = new Date(record.dimensions?.stat_time_day || record.stat_time_day);
        const metrics = record.metrics || {};

        // データレベルに応じて処理を分岐
        if (dataLevel === 'AUCTION_AD') {
          // ADレベルのメトリクス
          const adId = record.dimensions?.ad_id || record.ad_id;

          if (!adId) {
            this.logger.warn('Skipping AD record without ad_id');
            continue;
          }

          // DBのAdレコードを検索（tiktokIdで）
          const ad = await this.prisma.ad.findUnique({
            where: { tiktokId: String(adId) },
          });

          if (!ad) {
            this.logger.warn(`Ad not found in DB: ${adId}`);
            continue;
          }

          // メトリクスをupsert（ADレベル）
          await this.prisma.metric.upsert({
            where: {
              metric_ad_unique: {
                entityType: 'AD',
                adId: ad.id,
                statDate: statDate,
              },
            },
            create: {
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
              videoViews: parseInt(metrics.video_views || '0', 10),
              videoWatched2s: parseInt(metrics.video_watched_2s || '0', 10),
              videoWatched6s: parseInt(metrics.video_watched_6s || '0', 10),
            },
          });

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

          // メトリクスをupsert（ADGROUPレベル）
          await this.prisma.metric.upsert({
            where: {
              metric_adgroup_unique: {
                entityType: 'ADGROUP',
                adgroupId: adgroup.id,
                statDate: statDate,
              },
            },
            create: {
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

        } else if (dataLevel === 'AUCTION_CAMPAIGN') {
          // CAMPAIGNレベルのメトリクス（既存の処理）
          const campaignId = record.dimensions?.campaign_id || record.campaign_id;

          if (!campaignId) {
            this.logger.warn('Skipping CAMPAIGN record without campaign_id');
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

          // メトリクスをupsert（CAMPAIGNレベル）
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
      }

      this.logger.log(`Successfully saved ${reportData.length} ${dataLevel} metrics`);
    } catch (error) {
      this.logger.error(`Failed to save ${dataLevel} metrics to database`, error);
      throw error;
    }
  }
}
