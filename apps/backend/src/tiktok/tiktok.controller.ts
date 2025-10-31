import { Controller, Get, Post, Query, Body, Logger, Res } from '@nestjs/common';
import { Response } from 'express';
import { TiktokService } from './tiktok.service';

@Controller('auth/tiktok')
export class TiktokController {
  private readonly logger = new Logger(TiktokController.name);

  constructor(private readonly tiktokService: TiktokService) {}

  /**
   * OAuth認証URL取得
   * GET /auth/tiktok/url
   */
  @Get('url')
  getAuthUrl() {
    const url = this.tiktokService.getAuthUrl();
    return { authUrl: url };
  }

  /**
   * OAuth Callback - TikTokからリダイレクトされた際の処理
   * GET /auth/tiktok/callback?auth_code=xxx&state=xxx
   */
  @Get('callback')
  async handleCallback(
    @Query('auth_code') authCode: string,
    @Res() res: Response,
  ) {
    this.logger.log(`OAuth callback received with auth_code: ${authCode?.substring(0, 10)}...`);

    const frontendUrl = process.env.FRONTEND_URL || 'https://adsp-database.com';

    if (!authCode) {
      this.logger.error('No auth_code provided');
      return res.redirect(`${frontendUrl}/login?error=no_auth_code`);
    }

    try {
      const tokenData = await this.tiktokService.getAccessToken(authCode);

      // 認証成功 - ダッシュボードにリダイレクト
      this.logger.log('OAuth authentication successful, redirecting to dashboard');
      return res.redirect(`${frontendUrl}/dashboard`);
    } catch (error) {
      this.logger.error('OAuth callback failed', error);
      const errorMessage = encodeURIComponent(error.response?.data?.message || error.message || 'Authentication failed');
      return res.redirect(`${frontendUrl}/login?error=${errorMessage}`);
    }
  }

  /**
   * 手動でAuth Codeを使ってトークン取得
   * POST /auth/tiktok/token
   * Body: { "authCode": "xxx" }
   */
  @Post('token')
  async getToken(@Body('authCode') authCode: string) {
    this.logger.log(`Manual token request with auth_code: ${authCode?.substring(0, 10)}...`);

    if (!authCode) {
      return { success: false, error: 'authCode is required in request body' };
    }

    try {
      const tokenData = await this.tiktokService.getAccessToken(authCode);
      return {
        success: true,
        data: tokenData,
      };
    } catch (error) {
      this.logger.error('Token request failed', error);
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * トークンのリフレッシュ
   * POST /auth/tiktok/refresh
   * Body: { "refreshToken": "xxx" }
   */
  @Post('refresh')
  async refreshToken(@Body('refreshToken') refreshToken: string) {
    this.logger.log('Token refresh requested');

    if (!refreshToken) {
      return { success: false, error: 'refreshToken is required in request body' };
    }

    try {
      const tokenData = await this.tiktokService.refreshAccessToken(refreshToken);
      return {
        success: true,
        data: tokenData,
      };
    } catch (error) {
      this.logger.error('Token refresh failed', error);
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * Advertiser情報取得
   * POST /auth/tiktok/advertiser
   * Body: { "accessToken": "xxx" }
   */
  @Post('advertiser')
  async getAdvertiser(@Body('accessToken') accessToken: string) {
    this.logger.log('Advertiser info request');

    if (!accessToken) {
      return { success: false, error: 'accessToken is required in request body' };
    }

    try {
      const advertiserData = await this.tiktokService.getAdvertiserInfo(accessToken);
      return {
        success: true,
        data: advertiserData,
      };
    } catch (error) {
      this.logger.error('Failed to get advertiser info', error);
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * トークンをDBに保存
   * POST /auth/tiktok/save
   * Body: { "accessToken": "xxx", "advertiserIds": ["id1", "id2"], "scope": [1,2,3] }
   */
  @Post('save')
  async saveToken(
    @Body('accessToken') accessToken: string,
    @Body('advertiserIds') advertiserIds: string[],
    @Body('scope') scope?: number[],
  ) {
    this.logger.log(`Saving token for ${advertiserIds?.length || 0} advertisers`);

    if (!accessToken || !advertiserIds || advertiserIds.length === 0) {
      return {
        success: false,
        error: 'accessToken and advertiserIds are required',
      };
    }

    try {
      await this.tiktokService.saveTokens(advertiserIds, accessToken, undefined, scope);
      return {
        success: true,
        message: `Saved tokens for ${advertiserIds.length} advertisers`,
      };
    } catch (error) {
      this.logger.error('Failed to save tokens', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Campaign一覧取得
   * POST /auth/tiktok/campaigns
   * Body: { "advertiserId": "xxx", "accessToken": "xxx", "campaignIds": ["id1", "id2"] }
   */
  @Post('campaigns')
  async getCampaigns(
    @Body('advertiserId') advertiserId: string,
    @Body('accessToken') accessToken: string,
    @Body('campaignIds') campaignIds?: string[],
  ) {
    this.logger.log(`Getting campaigns for advertiser: ${advertiserId}`);

    if (!advertiserId || !accessToken) {
      return {
        success: false,
        error: 'advertiserId and accessToken are required',
      };
    }

    try {
      const campaignData = await this.tiktokService.getCampaigns(
        advertiserId,
        accessToken,
        campaignIds,
      );
      return {
        success: true,
        data: campaignData,
      };
    } catch (error) {
      this.logger.error('Failed to get campaigns', error);
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * Campaign作成
   * POST /auth/tiktok/campaign/create
   * Body: { "advertiserId": "xxx", "accessToken": "xxx", "campaignName": "xxx", "objectiveType": "xxx", "budgetMode": "xxx", "budget": 100 }
   */
  @Post('campaign/create')
  async createCampaign(
    @Body('advertiserId') advertiserId: string,
    @Body('accessToken') accessToken: string,
    @Body('campaignName') campaignName: string,
    @Body('objectiveType') objectiveType: string,
    @Body('budgetMode') budgetMode?: string,
    @Body('budget') budget?: number,
  ) {
    this.logger.log(`Creating campaign: ${campaignName} for advertiser: ${advertiserId}`);

    if (!advertiserId || !accessToken || !campaignName || !objectiveType) {
      return {
        success: false,
        error: 'advertiserId, accessToken, campaignName, and objectiveType are required',
      };
    }

    try {
      const campaignData = await this.tiktokService.createCampaign(
        advertiserId,
        accessToken,
        campaignName,
        objectiveType,
        budgetMode,
        budget,
      );
      return {
        success: true,
        data: campaignData,
      };
    } catch (error) {
      this.logger.error('Failed to create campaign', error);
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * Campaign更新
   * POST /auth/tiktok/campaign/update
   * Body: { "advertiserId": "xxx", "accessToken": "xxx", "campaignId": "xxx", "updates": {...} }
   */
  @Post('campaign/update')
  async updateCampaign(
    @Body('advertiserId') advertiserId: string,
    @Body('accessToken') accessToken: string,
    @Body('campaignId') campaignId: string,
    @Body('updates') updates: {
      campaignName?: string;
      budgetMode?: string;
      budget?: number;
      status?: string;
    },
  ) {
    this.logger.log(`Updating campaign: ${campaignId}`);

    if (!advertiserId || !accessToken || !campaignId) {
      return {
        success: false,
        error: 'advertiserId, accessToken, and campaignId are required',
      };
    }

    try {
      const campaignData = await this.tiktokService.updateCampaign(
        advertiserId,
        accessToken,
        campaignId,
        updates,
      );
      return {
        success: true,
        data: campaignData,
      };
    } catch (error) {
      this.logger.error('Failed to update campaign', error);
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * レポート取得（単一ページ）
   * POST /auth/tiktok/report
   * Body: { "advertiserId": "xxx", "accessToken": "xxx", "dataLevel": "AUCTION_CAMPAIGN", "startDate": "2025-01-01", "endDate": "2025-01-31" }
   */
  @Post('report')
  async getReport(
    @Body('advertiserId') advertiserId: string,
    @Body('accessToken') accessToken: string,
    @Body('dataLevel') dataLevel: 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD',
    @Body('startDate') startDate: string,
    @Body('endDate') endDate: string,
    @Body('dimensions') dimensions?: string[],
    @Body('metrics') metrics?: string[],
    @Body('filtering') filtering?: any,
    @Body('page') page?: number,
    @Body('pageSize') pageSize?: number,
  ) {
    this.logger.log(`Getting report for advertiser: ${advertiserId}, level: ${dataLevel}`);

    if (!advertiserId || !accessToken || !dataLevel || !startDate || !endDate) {
      return {
        success: false,
        error: 'advertiserId, accessToken, dataLevel, startDate, and endDate are required',
      };
    }

    try {
      const reportData = await this.tiktokService.getReport(
        advertiserId,
        accessToken,
        {
          dataLevel,
          startDate,
          endDate,
          dimensions,
          metrics,
          filtering,
          page,
          pageSize,
        },
      );
      return {
        success: true,
        data: reportData,
      };
    } catch (error) {
      this.logger.error('Failed to get report', error);
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * レポート取得（全ページ取得 + DB保存）
   * POST /auth/tiktok/report/fetch-and-save
   * Body: { "advertiserId": "xxx", "accessToken": "xxx", "dataLevel": "AUCTION_CAMPAIGN", "startDate": "2025-01-01", "endDate": "2025-01-31" }
   */
  @Post('report/fetch-and-save')
  async fetchAndSaveReport(
    @Body('advertiserId') advertiserId: string,
    @Body('accessToken') accessToken: string,
    @Body('dataLevel') dataLevel: 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD',
    @Body('startDate') startDate: string,
    @Body('endDate') endDate: string,
    @Body('dimensions') dimensions?: string[],
    @Body('metrics') metrics?: string[],
    @Body('filtering') filtering?: any,
  ) {
    this.logger.log(`Fetching and saving report for advertiser: ${advertiserId}`);

    if (!advertiserId || !accessToken || !dataLevel || !startDate || !endDate) {
      return {
        success: false,
        error: 'advertiserId, accessToken, dataLevel, startDate, and endDate are required',
      };
    }

    try {
      // 全ページのデータ取得
      const allData = await this.tiktokService.getAllReportData(
        advertiserId,
        accessToken,
        {
          dataLevel,
          startDate,
          endDate,
          dimensions,
          metrics,
          filtering,
        },
      );

      // DBに保存
      if (allData.length > 0) {
        await this.tiktokService.saveReportMetrics(allData, dataLevel);
      }

      return {
        success: true,
        message: `Fetched and saved ${allData.length} records`,
        recordCount: allData.length,
      };
    } catch (error) {
      this.logger.error('Failed to fetch and save report', error);
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }
}
