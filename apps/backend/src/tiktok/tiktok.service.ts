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
          filtering: JSON.stringify({
            adgroup_ids: [adgroupId],
          }),
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
        schedule_start_time: options.scheduleStartTime,
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

      // Log request body for debugging
      this.logger.log('AdGroup create request body:', JSON.stringify(requestBody, null, 2));

      const response = await this.httpClient.post('/v1.3/adgroup/create/', requestBody, {
        headers: {
          'Access-Token': accessToken,
        },
      });

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
        // API v1.3: Use call_to_action_id instead of call_to_action string
        call_to_action_id: '7569153453977603079', // LEARN_MORE CTA ID
        landing_page_url: options.landingPageUrl,
        display_name: options.identity || 'a356c51a-18f2-5f1e-b784-ccb3b107099e',
        identity_id: options.identity || 'a356c51a-18f2-5f1e-b784-ccb3b107099e', // API v1.3: Required in creatives array (スキルプラス - AVAILABLE)
        identity_type: 'TT_USER',
      };

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
    advertiserId?: string,
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

          // メトリクスを保存（ADレベル）- 既存レコードを検索してupdate or create
          const existingMetric = await this.prisma.metric.findFirst({
            where: {
              entityType: 'AD',
              adId: ad.id,
              statDate: statDate,
            },
          });

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

          if (existingMetric) {
            await this.prisma.metric.update({
              where: { id: existingMetric.id },
              data: metricData,
            });
            this.logger.debug(`Updated existing metric for ad ${adId}`);
          } else {
            await this.prisma.metric.create({
              data: metricData,
            });
            this.logger.debug(`Created new metric for ad ${adId}`);
          }

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

          // メトリクスを保存（ADGROUPレベル）- 既存レコードを検索してupdate or create
          const existingMetric = await this.prisma.metric.findFirst({
            where: {
              entityType: 'ADGROUP',
              adgroupId: adgroup.id,
              statDate: statDate,
            },
          });

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

          if (existingMetric) {
            await this.prisma.metric.update({
              where: { id: existingMetric.id },
              data: metricData,
            });
          } else {
            await this.prisma.metric.create({
              data: metricData,
            });
          }

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

          // メトリクスを保存（CAMPAIGNレベル）- 既存レコードを検索してupdate or create
          const existingMetric = await this.prisma.metric.findFirst({
            where: {
              entityType: 'CAMPAIGN',
              campaignId: campaign.id,
              statDate: statDate,
            },
          });

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

          if (existingMetric) {
            await this.prisma.metric.update({
              where: { id: existingMetric.id },
              data: metricData,
            });
          } else {
            await this.prisma.metric.create({
              data: metricData,
            });
          }
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
   */
  async getSmartPlusAds(advertiserId: string, accessToken: string, smartPlusAdIds?: string[]) {
    try {
      this.logger.log(`Fetching Smart+ ads for advertiser: ${advertiserId}`);

      const params: any = {
        advertiser_id: advertiserId,
        page_size: 100, // 最大値
      };

      if (smartPlusAdIds && smartPlusAdIds.length > 0) {
        params.filtering = JSON.stringify({
          smart_plus_ad_ids: smartPlusAdIds,
        });
      }

      this.logger.log(`Request params: ${JSON.stringify(params)}`);

      const response = await this.httpClient.get('/v1.3/smart_plus/ad/get/', {
        headers: {
          'Access-Token': accessToken,
        },
        params,
      });

      this.logger.log(`Retrieved ${response.data.data?.list?.length || 0} Smart+ ads`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get Smart+ ads');
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
}
