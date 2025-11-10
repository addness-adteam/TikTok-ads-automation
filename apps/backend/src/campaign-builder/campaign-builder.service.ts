import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TiktokService } from '../tiktok/tiktok.service';
import { ConfigService } from '@nestjs/config';

export interface CampaignBuilderInput {
  // 共通項目
  advertiserId: string;
  campaignName: string;
  pixelId: string; // データ連携
  optimizationEvent: string; // 最適化イベント
  dailyBudget: number; // 日予算

  // パターン選択
  pattern: 'NON_TARGETING' | 'LOOKALIKE';

  // 類似パターンの場合
  includedAudiences?: string[]; // 含めるオーディエンス
  excludedAudiences?: string[]; // 除外するオーディエンス

  // 広告情報
  ads: {
    adName: string;
    creativeId: string; // DBのCreative ID
    landingPageUrl: string;
    thumbnailImageId?: string; // 動画広告の場合のサムネイル画像ID
  }[];
}

@Injectable()
export class CampaignBuilderService {
  private readonly logger = new Logger(CampaignBuilderService.name);

  constructor(
    private prisma: PrismaService,
    private tiktokService: TiktokService,
    private configService: ConfigService,
  ) {}

  /**
   * Campaign + AdGroup + Ad を一括作成
   */
  async buildCampaign(input: CampaignBuilderInput, accessToken: string) {
    this.logger.log(`Building campaign: ${input.campaignName}`);

    try {
      // 1. Advertiserの訴求を取得
      const advertiser = await this.prisma.advertiser.findUnique({
        where: { tiktokAdvertiserId: input.advertiserId },
        include: { appeal: true },
      });

      if (!advertiser || !advertiser.appeal) {
        throw new Error(`Advertiser ${input.advertiserId} not found or has no appeal`);
      }

      const appealName = advertiser.appeal.name; // SNS or AI

      // 2. Campaign作成
      const campaign = await this.createCampaign(
        advertiser.id, // Advertiser UUID
        input.advertiserId, // TikTok Advertiser ID
        input.campaignName,
        accessToken,
      );

      // 3. AdGroup作成
      const adGroup = await this.createAdGroup(
        input.advertiserId,
        String(campaign.data.campaign_id), // Convert to string for API v1.3
        input.pattern,
        input.dailyBudget,
        input.pixelId,
        input.optimizationEvent,
        input.includedAudiences,
        input.excludedAudiences,
        accessToken,
      );

      // 4. Ad作成（複数）
      const ads: any[] = [];
      for (const adInput of input.ads) {
        const ad = await this.createAd(
          input.advertiserId,
          adGroup.data.adgroup_id,
          adInput.adName,
          adInput.creativeId,
          adInput.landingPageUrl,
          appealName,
          adInput.thumbnailImageId,
          accessToken,
        );
        ads.push(ad);
      }

      this.logger.log(
        `Campaign created successfully: Campaign=${campaign.data.campaign_id}, AdGroup=${adGroup.data.adgroup_id}, Ads=${ads.length}`,
      );

      return {
        campaign,
        adGroup,
        ads,
      };
    } catch (error) {
      this.logger.error('Failed to build campaign', error);
      throw error;
    }
  }

  /**
   * Campaign作成
   */
  private async createCampaign(
    advertiserUuid: string,
    tiktokAdvertiserId: string,
    campaignName: string,
    accessToken: string,
  ) {
    this.logger.log(`Creating campaign: ${campaignName}`);

    return this.tiktokService.createCampaign(
      tiktokAdvertiserId,
      accessToken,
      campaignName,
      'LEAD_GENERATION', // リード生成
      'BUDGET_MODE_INFINITE', // 無制限（AdGroupで予算設定）
      undefined,
      advertiserUuid, // Advertiser UUID for DB storage
    );
  }

  /**
   * AdGroup作成
   */
  private async createAdGroup(
    advertiserId: string,
    campaignId: string,
    pattern: string,
    dailyBudget: number,
    pixelId: string,
    optimizationEvent: string,
    includedAudiences: string[] = [],
    excludedAudiences: string[] = [],
    accessToken: string,
  ) {
    this.logger.log(`Creating adgroup with pattern: ${pattern}`);

    // 広告セット名を生成（YYMMDD + パターン名）
    const today = new Date();
    const dateStr = `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const patternName = pattern === 'NON_TARGETING' ? 'ノンタゲ' : '類似';
    const adgroupName = `${dateStr} ${patternName}`;

    // スケジュール設定（15時判定）
    // API v1.3: Use 'YYYY-MM-DD HH:mm:ss' format for SCHEDULE_FROM_NOW
    const currentHour = today.getHours();
    const startTime = currentHour < 15
      ? today.toISOString().replace('T', ' ').split('.')[0]
      : new Date(today.setDate(today.getDate() + 1)).toISOString().split('T')[0] + ' 00:00:00';

    // ターゲティング設定
    const targeting = {
      location_ids: ['6252001'], // 日本
      age_groups: ['AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_100'],
      gender: 'GENDER_UNLIMITED',
      languages: ['ja'], // 日本語
      spending_power: 'ALL', // API v1.3: 'ALL' or 'HIGH' (was 'UNLIMITED' in v1.2)
      ...(pattern === 'LOOKALIKE' && {
        included_custom_audiences: includedAudiences,
        excluded_custom_audiences: excludedAudiences,
      }),
    };

    return this.tiktokService.createAdGroup(
      advertiserId,
      campaignId,
      adgroupName,
      {
        placementType: 'PLACEMENT_TYPE_NORMAL',
        placements: ['PLACEMENT_TIKTOK'],
        budgetMode: 'BUDGET_MODE_DAY',
        budget: dailyBudget,
        bidType: 'BID_TYPE_NO_BID', // 自動入札
        optimizationGoal: 'CONVERT', // API v1.3: CONVERT for LEAD_GENERATION campaigns
        pixelId,
        optimizationEvent,
        targeting,
        scheduleStartTime: startTime,
        scheduleEndTime: undefined, // 終了時間なし
      },
      accessToken,
    );
  }

  /**
   * Ad作成
   */
  private async createAd(
    advertiserId: string,
    adgroupId: string,
    adName: string,
    creativeId: string,
    landingPageUrl: string,
    appealName: string,
    thumbnailImageId: string | undefined,
    accessToken: string,
  ) {
    this.logger.log(`Creating ad: ${adName}`);

    // Creativeを取得
    const creative = await this.prisma.creative.findUnique({
      where: { id: creativeId },
    });

    if (!creative) {
      throw new Error(`Creative not found: ${creativeId}`);
    }

    // 広告テキスト生成
    const adText = appealName === 'SNS'
      ? 'SNSで独立するなら学んでおきたい本質のSNSマーケ特商法（https://skill.addness.co.jp/tokushoho）'
      : 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';

    // Creative typeに基づいて適切なパラメータを設定
    if (creative.type === 'VIDEO') {
      // 動画広告: video_id + サムネイル画像ID
      // DBに保存されているtiktokImageIdは動画のサムネイル画像ID
      if (!creative.tiktokImageId) {
        throw new Error(`Video creative ${creativeId} missing thumbnail image ID`);
      }

      return this.tiktokService.createAd(
        advertiserId,
        adgroupId,
        adName,
        {
          identity: 'a356c51a-18f2-5f1e-b784-ccb3b107099e',
          videoId: creative.tiktokVideoId ?? undefined,
          imageIds: [creative.tiktokImageId], // サムネイル画像ID（動画アップロード時に自動生成）
          adText,
          callToAction: 'LEARN_MORE',
          landingPageUrl,
          displayMode: 'AD_ONLY',
          creativeAuthorized: false,
        },
        accessToken,
      );
    } else if (creative.type === 'IMAGE') {
      // 画像広告: image_idsのみ使用
      return this.tiktokService.createAd(
        advertiserId,
        adgroupId,
        adName,
        {
          identity: 'a356c51a-18f2-5f1e-b784-ccb3b107099e',
          imageIds: [creative.tiktokImageId!],
          adText,
          callToAction: 'LEARN_MORE',
          landingPageUrl,
          displayMode: 'AD_ONLY',
          creativeAuthorized: false,
        },
        accessToken,
      );
    } else {
      throw new Error(`Unknown creative type: ${creative.type}`);
    }
  }
}
