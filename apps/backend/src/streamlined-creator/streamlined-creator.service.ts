/**
 * ワンストップ出稿サービス
 * ギガファイル便URL → 動画DL → TikTokアップロード → UTAGE登録経路 → キャンペーン作成
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TiktokService } from '../tiktok/tiktok.service';
import { UtageService } from '../utage/utage.service';
import { GigafileService } from './gigafile.service';
import { AD_TEXT, TARGET_AGE_GROUPS, DEFAULT_BUDGET, ADVERTISER_APPEAL_MAP } from './constants';
import {
  CreateSingleInput,
  CreateSingleResult,
  PreviewInput,
  PreviewResult,
  CustomAudience,
} from './types';

@Injectable()
export class StreamlinedCreatorService {
  private readonly logger = new Logger(StreamlinedCreatorService.name);

  constructor(
    private prisma: PrismaService,
    private tiktokService: TiktokService,
    private utageService: UtageService,
    private gigafileService: GigafileService,
  ) {}

  /**
   * ギガファイル便URLからファイル名を取得（プレビュー用）
   */
  async preview(input: PreviewInput): Promise<PreviewResult> {
    const files: PreviewResult['files'] = [];

    for (const url of input.gigafileUrls) {
      try {
        const filename = await this.gigafileService.getFilename(url);
        files.push({ url, filename });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        files.push({ url, filename: `取得失敗: ${msg}` });
      }
    }

    return { files };
  }

  /**
   * カスタムオーディエンス一覧取得
   */
  async getCustomAudiences(advertiserId: string): Promise<CustomAudience[]> {
    const token = await this.getAccessToken(advertiserId);
    return this.tiktokService.getCustomAudiences(advertiserId, token);
  }

  /**
   * 1動画分の出稿を実行
   */
  async createSingle(input: CreateSingleInput): Promise<CreateSingleResult> {
    this.logger.log(`ワンストップ出稿開始: ${input.gigafileUrl} → ${input.advertiserId}`);

    let currentStep = 'GIGAFILE_DOWNLOAD';

    try {
      const token = await this.getAccessToken(input.advertiserId);
      const advertiser = await this.prisma.advertiser.findUnique({
        where: { tiktokAdvertiserId: input.advertiserId },
        include: { appeal: true },
      });

      if (!advertiser) {
        throw new Error(`アカウント ${input.advertiserId} がDBに見つかりません`);
      }

      if (!advertiser.pixelId) {
        throw new Error(`アカウント ${input.advertiserId} のピクセルIDが未設定です`);
      }

      if (!advertiser.identityId) {
        throw new Error(`アカウント ${input.advertiserId} のIdentity IDが未設定です`);
      }

      // 1. ギガファイル便から動画DL
      currentStep = 'GIGAFILE_DOWNLOAD';
      const { buffer, filename } = await this.gigafileService.downloadVideo(input.gigafileUrl);
      this.logger.log(`動画DL完了: ${filename} (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);

      // 2. TikTokへ動画アップロード
      currentStep = 'VIDEO_UPLOAD';
      const videoId = await this.tiktokService.uploadVideoToAccount(
        input.advertiserId,
        token,
        buffer,
        filename,
      );
      this.logger.log(`動画アップロード完了: ${videoId}`);

      // 3. 動画処理完了待ち
      currentStep = 'VIDEO_PROCESSING';
      await this.tiktokService.waitForVideoReady(input.advertiserId, token, videoId);

      // 4. サムネイル取得
      currentStep = 'THUMBNAIL_UPLOAD';
      const thumbnailImageId = await this.tiktokService.uploadVideoThumbnail(
        input.advertiserId,
        token,
        videoId,
      );
      this.logger.log(`サムネイル取得完了: ${thumbnailImageId}`);

      // 5. UTAGE登録経路作成
      currentStep = 'UTAGE_CREATE';
      const utageResult = await this.utageService.createRegistrationPathAndGetUrl(
        input.appeal,
        input.lpNumber,
      );
      this.logger.log(`UTAGE登録経路作成完了: CR${String(utageResult.crNumber).padStart(5, '0')}`);

      // 6. 広告名生成
      const adName = this.generateAdName(
        input.creatorName,
        input.crName,
        input.lpNumber,
        utageResult.crNumber,
      );
      const dailyBudget = input.dailyBudget || DEFAULT_BUDGET[input.appeal] || 3000;
      const adText = input.adText || AD_TEXT[input.appeal] || AD_TEXT['AI'];

      // 7. キャンペーン作成
      currentStep = 'CAMPAIGN_CREATE';
      const campaignResp = await this.tiktokService.createCampaign(
        input.advertiserId,
        token,
        adName,
        'LEAD_GENERATION',
        'BUDGET_MODE_INFINITE',
        undefined,
        advertiser.id,
      );
      const campaignId = String(campaignResp.data?.campaign_id);
      this.logger.log(`キャンペーン作成完了: ${campaignId}`);

      // 8. 広告グループ作成
      currentStep = 'ADGROUP_CREATE';
      const adgroupName = this.generateAdGroupName();
      const targeting: any = {
        location_ids: ['1861060'], // 日本
        age_groups: TARGET_AGE_GROUPS,
        gender: 'GENDER_UNLIMITED',
        languages: ['ja'],
      };

      if (input.excludedAudienceIds && input.excludedAudienceIds.length > 0) {
        targeting.excluded_custom_audiences = input.excludedAudienceIds;
      }

      const adgroupResp = await this.tiktokService.createAdGroup(
        input.advertiserId,
        campaignId,
        adgroupName,
        {
          placementType: 'PLACEMENT_TYPE_NORMAL',
          placements: ['PLACEMENT_TIKTOK'],
          budgetMode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
          budget: dailyBudget,
          bidType: 'BID_TYPE_NO_BID',
          optimizationGoal: 'CONVERT',
          pixelId: advertiser.pixelId,
          optimizationEvent: 'ON_WEB_REGISTER',
          targeting,
        },
        token,
      );
      const adgroupId = String(adgroupResp.data?.adgroup_id);
      this.logger.log(`広告グループ作成完了: ${adgroupId}`);

      // 9. 広告作成
      currentStep = 'AD_CREATE';
      const landingPageUrl = this.buildLandingPageUrl(utageResult.destinationUrl);
      const adResp = await this.tiktokService.createAd(
        input.advertiserId,
        adgroupId,
        adName,
        {
          identity: advertiser.identityId,
          identityType: 'BC_AUTH_TT',
          identityAuthorizedBcId: advertiser.identityAuthorizedBcId || undefined,
          videoId,
          imageIds: [thumbnailImageId],
          adText,
          callToAction: 'LEARN_MORE',
          landingPageUrl,
        },
        token,
      );
      const adId = String(adResp.data?.ad_ids?.[0] || adResp.data?.ad_id);
      this.logger.log(`広告作成完了: ${adId}`);

      return {
        status: 'SUCCESS',
        adName,
        adId,
        campaignId,
        adgroupId,
        crNumber: utageResult.crNumber,
        utagePath: utageResult.registrationPath,
        destinationUrl: utageResult.destinationUrl,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`ワンストップ出稿失敗 (${currentStep}): ${errorMsg}`);

      return {
        status: 'FAILED',
        error: errorMsg,
        failedStep: currentStep,
      };
    }
  }

  // ========== ヘルパーメソッド ==========

  private async getAccessToken(advertiserId: string): Promise<string> {
    const token = await this.prisma.oAuthToken.findUnique({
      where: { advertiserId },
    });
    if (!token) throw new Error(`アクセストークンが見つかりません: ${advertiserId}`);
    return token.accessToken;
  }

  /**
   * 広告名生成: YYMMDD/制作者名/CR名/LP{n}-CR{5桁}
   */
  private generateAdName(
    creatorName: string,
    crName: string,
    lpNumber: number,
    crNumber: number,
  ): string {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const dateStr = `${String(jst.getUTCFullYear()).slice(2)}${String(jst.getUTCMonth() + 1).padStart(2, '0')}${String(jst.getUTCDate()).padStart(2, '0')}`;
    const crStr = String(crNumber).padStart(5, '0');
    return `${dateStr}/${creatorName}/${crName}/LP${lpNumber}-CR${crStr}`;
  }

  /**
   * 広告グループ名: YYMMDD ノンタゲ
   */
  private generateAdGroupName(): string {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const dateStr = `${String(jst.getUTCFullYear()).slice(2)}${String(jst.getUTCMonth() + 1).padStart(2, '0')}${String(jst.getUTCDate()).padStart(2, '0')}`;
    return `${dateStr} ノンタゲ`;
  }

  /**
   * UTM付きLP URL構築
   */
  private buildLandingPageUrl(destinationUrl: string): string {
    const separator = destinationUrl.includes('?') ? '&' : '?';
    return `${destinationUrl}${separator}utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
  }
}
