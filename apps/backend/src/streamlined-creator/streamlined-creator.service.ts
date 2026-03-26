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
  CreateBatchInput,
  CreateBatchResult,
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
   * 1動画分の出稿を実行（複数ファイルの場合は自動で一括出稿に切り替え）
   */
  async createSingle(input: CreateSingleInput): Promise<CreateSingleResult | CreateBatchResult> {
    this.logger.log(`ワンストップ出稿開始: ${input.gigafileUrl} → ${input.advertiserId}`);

    // ギガファイル便に複数ファイルがある場合は一括出稿に切り替え
    const allVideos = await this.gigafileService.downloadAllVideos(input.gigafileUrl);
    if (allVideos.length > 1) {
      this.logger.log(`複数ファイル検出（${allVideos.length}本）→ 一括出稿に切り替え`);
      return this.createBatchFromVideos(allVideos, input);
    }

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

      // 1. ギガファイル便から動画DL（既にDL済み）
      currentStep = 'GIGAFILE_DOWNLOAD';
      const { buffer, filename } = allVideos[0];
      this.logger.log(`動画DL完了: ${filename} (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);

      // DLバリデーション: 1MB未満は動画ではなくHTMLやエラーレスポンスの可能性
      if (buffer.length < 1024 * 1024) {
        const preview = buffer.toString('utf-8', 0, Math.min(500, buffer.length));
        if (preview.includes('<html') || preview.includes('<!DOCTYPE') || preview.includes('gigafile')) {
          throw new Error(`ギガファイル便: 動画ではなくHTMLがダウンロードされました（${buffer.length}bytes）。DL URLの構築に失敗した可能性があります。`);
        }
        this.logger.warn(`動画サイズが小さいです: ${buffer.length}bytes。正常なファイルか確認してください。`);
      }

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
      const videoInfo = await this.tiktokService.waitForVideoReady(input.advertiserId, token, videoId);
      if (!videoInfo) {
        throw new Error(`動画 ${videoId} の処理がタイムアウトしました。TikTok側での動画処理に時間がかかっています。数分後に再試行してください。`);
      }

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

      // 6. 広告名生成（CR名: ユーザー入力 or ファイル名から自動抽出）
      const effectiveCrName = input.crName || this.extractCrNameFromFilename(filename);
      const adName = this.generateAdName(
        input.creatorName,
        effectiveCrName,
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

  /**
   * ギガファイル便の複数ファイルを一括出稿（各動画ごとに1キャンペーン-1広告グループ-1広告）
   */
  async createBatch(input: CreateBatchInput): Promise<CreateBatchResult> {
    this.logger.log(`一括出稿開始: ${input.gigafileUrl} → ${input.advertiserId}`);
    const videos = await this.gigafileService.downloadAllVideos(input.gigafileUrl);
    return this.createBatchFromVideos(videos, input);
  }

  /**
   * DL済み動画配列から一括出稿（create-single/create-batch共通ロジック）
   */
  private async createBatchFromVideos(
    videos: { buffer: Buffer; filename: string }[],
    input: CreateSingleInput | CreateBatchInput,
  ): Promise<CreateBatchResult> {
    this.logger.log(`${videos.length}本の動画を一括出稿`);

    const results: CreateSingleResult[] = [];
    let success = 0;
    let failed = 0;

    for (let i = 0; i < videos.length; i++) {
      const { buffer, filename } = videos[i];
      this.logger.log(`[${i + 1}/${videos.length}] 出稿中: ${filename} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);

      let currentStep = 'VIDEO_UPLOAD';
      try {
        const token = await this.getAccessToken(input.advertiserId);
        const advertiser = await this.prisma.advertiser.findUnique({
          where: { tiktokAdvertiserId: input.advertiserId },
          include: { appeal: true },
        });
        if (!advertiser || !advertiser.pixelId || !advertiser.identityId) {
          throw new Error(`アカウント設定不備: ${input.advertiserId}`);
        }

        // DLバリデーション
        if (buffer.length < 1024 * 1024) {
          const preview = buffer.toString('utf-8', 0, Math.min(500, buffer.length));
          if (preview.includes('<html') || preview.includes('<!DOCTYPE')) {
            throw new Error(`動画${i + 1}: HTMLがDLされました（${buffer.length}bytes）`);
          }
        }

        // 動画アップロード
        currentStep = 'VIDEO_UPLOAD';
        const videoId = await this.tiktokService.uploadVideoToAccount(
          input.advertiserId, token, buffer, filename,
        );

        // 動画処理待ち
        currentStep = 'VIDEO_PROCESSING';
        const videoInfo = await this.tiktokService.waitForVideoReady(input.advertiserId, token, videoId);
        if (!videoInfo) {
          throw new Error(`動画 ${videoId} の処理がタイムアウトしました`);
        }

        // サムネイル
        currentStep = 'THUMBNAIL_UPLOAD';
        const thumbnailImageId = await this.tiktokService.uploadVideoThumbnail(
          input.advertiserId, token, videoId,
        );

        // UTAGE登録経路（各動画ごとに別CR番号）
        currentStep = 'UTAGE_CREATE';
        const utageResult = await this.utageService.createRegistrationPathAndGetUrl(
          input.appeal, input.lpNumber,
        );

        // 広告名（CR名: ユーザー入力 or ファイル名から自動抽出）
        const effectiveCrName = input.crName || this.extractCrNameFromFilename(filename);
        const adName = this.generateAdName(
          input.creatorName, effectiveCrName, input.lpNumber, utageResult.crNumber,
        );
        const dailyBudget = input.dailyBudget || DEFAULT_BUDGET[input.appeal] || 3000;
        const adText = input.adText || AD_TEXT[input.appeal] || AD_TEXT['AI'];

        // キャンペーン作成
        currentStep = 'CAMPAIGN_CREATE';
        const campaignResp = await this.tiktokService.createCampaign(
          input.advertiserId, token, adName, 'LEAD_GENERATION',
          'BUDGET_MODE_INFINITE', undefined, advertiser.id,
        );
        const campaignId = String(campaignResp.data?.campaign_id);

        // 広告グループ作成
        currentStep = 'ADGROUP_CREATE';
        const targeting: any = {
          location_ids: ['1861060'],
          age_groups: TARGET_AGE_GROUPS,
          gender: 'GENDER_UNLIMITED',
          languages: ['ja'],
        };
        if (input.excludedAudienceIds?.length) {
          targeting.excluded_custom_audiences = input.excludedAudienceIds;
        }
        const adgroupResp = await this.tiktokService.createAdGroup(
          input.advertiserId, campaignId, this.generateAdGroupName(),
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

        // 広告作成
        currentStep = 'AD_CREATE';
        const landingPageUrl = this.buildLandingPageUrl(utageResult.destinationUrl);
        const adResp = await this.tiktokService.createAd(
          input.advertiserId, adgroupId, adName,
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

        this.logger.log(`[${i + 1}/${videos.length}] 出稿完了: ${adName} (ad_id: ${adId})`);
        results.push({
          status: 'SUCCESS',
          adName, adId, campaignId, adgroupId,
          crNumber: utageResult.crNumber,
          utagePath: utageResult.registrationPath,
          destinationUrl: utageResult.destinationUrl,
        });
        success++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(`[${i + 1}/${videos.length}] 出稿失敗 (${currentStep}): ${errorMsg}`);
        results.push({ status: 'FAILED', error: errorMsg, failedStep: currentStep });
        failed++;
      }
    }

    this.logger.log(`一括出稿完了: ${success}成功 / ${failed}失敗 (全${videos.length}本)`);
    return { totalFiles: videos.length, success, failed, results };
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
   * 配信開始日の日付文字列（YYMMDD）を返す
   * JST 15時以降 → 翌日（翌日0時から配信開始のため）
   * JST 15時前 → 当日（即配信開始のため）
   */
  private getDeliveryDateStr(): string {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    if (jst.getUTCHours() >= 15) {
      jst.setUTCDate(jst.getUTCDate() + 1);
    }
    return `${String(jst.getUTCFullYear()).slice(2)}${String(jst.getUTCMonth() + 1).padStart(2, '0')}${String(jst.getUTCDate()).padStart(2, '0')}`;
  }

  /**
   * 広告名生成: YYMMDD/制作者名/CR名/LP{n}-CR{5桁}
   * 日付は配信開始日を使用
   */
  private generateAdName(
    creatorName: string,
    crName: string,
    lpNumber: number,
    crNumber: number,
  ): string {
    const dateStr = this.getDeliveryDateStr();
    const crStr = String(crNumber).padStart(5, '0');
    return `${dateStr}/${creatorName}/${crName}/LP${lpNumber}-CR${crStr}`;
  }

  /**
   * 広告グループ名: YYMMDD ノンタゲ（配信開始日）
   */
  private generateAdGroupName(): string {
    return `${this.getDeliveryDateStr()} ノンタゲ`;
  }

  /**
   * 動画ファイル名からCR名を抽出（拡張子を除去）
   * 例: "庭_女性演者_冒頭1.mp4" → "庭_女性演者_冒頭1"
   */
  private extractCrNameFromFilename(filename: string): string {
    return filename.replace(/\.[^.]+$/, '').trim() || filename;
  }

  /**
   * UTM付きLP URL構築
   */
  private buildLandingPageUrl(destinationUrl: string): string {
    const separator = destinationUrl.includes('?') ? '&' : '?';
    return `${destinationUrl}${separator}utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
  }
}
