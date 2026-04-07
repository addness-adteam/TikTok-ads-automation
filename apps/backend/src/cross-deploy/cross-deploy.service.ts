/**
 * 横展開サービス
 * Smart+広告/通常配信の両対応でアカウント間の広告横展開を実行
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TiktokService } from '../tiktok/tiktok.service';
import { UtageService } from '../utage/utage.service';
import { DEFAULT_DAILY_BUDGET, DEEP_FUNNEL_CONFIG } from '../utage/utage.types';
import {
  CrossDeployInput,
  CrossDeployResult,
  PreviewResult,
} from './types';

@Injectable()
export class CrossDeployService {
  private readonly logger = new Logger(CrossDeployService.name);

  constructor(
    private prisma: PrismaService,
    private tiktokService: TiktokService,
    private utageService: UtageService,
  ) {}

  /**
   * 元広告のプレビュー（動画数、広告文、LP等を表示）
   */
  async preview(
    sourceAdvertiserId: string,
    sourceAdId: string,
  ): Promise<PreviewResult> {
    const token = await this.getAccessToken(sourceAdvertiserId);

    const detail = await this.tiktokService.getSmartPlusAdFullDetail(
      sourceAdvertiserId,
      token,
      sourceAdId,
    );

    return {
      sourceAdvertiserId,
      sourceAdId,
      adName: detail.adName,
      adFormat: detail.adFormat,
      videoCount: detail.videoIds.length,
      videoIds: detail.videoIds,
      imageCount: detail.imageIds.length,
      imageIds: detail.imageIds,
      adTexts: detail.adTexts,
      landingPageUrls: detail.landingPageUrls,
      adConfiguration: detail.adConfiguration,
    };
  }

  /**
   * メイン横展開実行
   */
  async crossDeploy(input: CrossDeployInput): Promise<CrossDeployResult[]> {
    this.logger.log(`横展開開始: ${input.sourceAdId} → ${input.targetAdvertiserIds.join(', ')} (mode: ${input.mode})`);

    // 1. 元広告データ取得
    const sourceToken = await this.getAccessToken(input.sourceAdvertiserId);
    const sourceDetail = await this.tiktokService.getSmartPlusAdFullDetail(
      input.sourceAdvertiserId,
      sourceToken,
      input.sourceAdId,
    );

    const hasImages = sourceDetail.imageIds.length > 0;
    const hasVideos = sourceDetail.videoIds.length > 0;

    if (!hasImages && !hasVideos) {
      throw new Error('元広告にvideo_idもimage_idも見つかりません');
    }

    // 3. 元広告名からappeal/LP番号を抽出
    const { appeal, lpNumber } = this.parseAdNameForAppeal(sourceDetail.adName, input.sourceAdvertiserId);

    // 4. メディアをダウンロード（画像・動画それぞれ存在する分だけ）
    const imageBuffers: Map<string, Buffer> = new Map();
    const videoBuffers: Map<string, Buffer> = new Map();

    // 画像ダウンロード
    if (hasImages) {
      this.logger.log(`画像: ${sourceDetail.imageIds.length}枚をダウンロード`);
      const imageInfos = await this.tiktokService.getImageInfo(
        input.sourceAdvertiserId,
        sourceToken,
        sourceDetail.imageIds,
      );

      for (const imageId of sourceDetail.imageIds) {
        const info = imageInfos.find((img: any) => img.image_id === imageId);
        const imageUrl = info?.image_url;
        if (!imageUrl) {
          throw new Error(`画像 ${imageId} のURLが取得できません`);
        }
        const resp = await fetch(imageUrl);
        const buffer = Buffer.from(await resp.arrayBuffer());
        imageBuffers.set(imageId, buffer);
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // 動画ダウンロード
    let videoIdsToUse: string[] = [];
    if (hasVideos) {
      let videoIndicesToUse: number[];
      if (input.videoIndices && input.videoIndices.length > 0) {
        videoIndicesToUse = input.videoIndices;
      } else {
        videoIndicesToUse = sourceDetail.videoIds.map((_, i) => i);
      }

      videoIdsToUse = videoIndicesToUse.map(i => sourceDetail.videoIds[i]).filter(Boolean);
      this.logger.log(`動画: ${videoIdsToUse.length}本 / ${sourceDetail.videoIds.length}本をダウンロード`);

      const videoInfos = await this.tiktokService.getVideoInfo(
        input.sourceAdvertiserId,
        sourceToken,
        videoIdsToUse,
      );

      for (const videoId of videoIdsToUse) {
        const info = videoInfos.find((v: any) => v.video_id === videoId);
        const downloadUrl = info?.preview_url || info?.video_url;
        if (!downloadUrl) {
          throw new Error(`動画 ${videoId} のダウンロードURLが取得できません`);
        }

        const buffer = await this.tiktokService.downloadVideo(downloadUrl);
        videoBuffers.set(videoId, buffer);
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // 5. 各ターゲットアカウントで横展開実行
    const results: CrossDeployResult[] = [];

    for (const targetAdvertiserId of input.targetAdvertiserIds) {
      // 常にSmart+モードで出稿（通常広告は予算調整V2で認識されにくいため）
      if (input.mode === 'REGULAR') {
        this.logger.warn(`[横展開] REGULARモード指定がありましたが、Smart+モードで出稿します`);
      }
      const result = await this.deploySmartPlus(
        input, targetAdvertiserId, sourceDetail, videoIdsToUse, videoBuffers, imageBuffers, appeal, lpNumber,
      );
      results.push(result);
    }

    this.logger.log(`横展開完了: 成功=${results.filter(r => r.status === 'SUCCESS').length}, 失敗=${results.filter(r => r.status === 'FAILED').length}`);
    return results;
  }

  /**
   * Smart+モードの横展開（全動画→1広告）
   */
  private async deploySmartPlus(
    input: CrossDeployInput,
    targetAdvertiserId: string,
    sourceDetail: Awaited<ReturnType<TiktokService['getSmartPlusAdFullDetail']>>,
    videoIdsToUse: string[],
    videoBuffers: Map<string, Buffer>,
    imageBuffers: Map<string, Buffer>,
    appeal: string,
    lpNumber: number,
  ): Promise<CrossDeployResult> {
    // CrossDeployLogを作成
    const log = await this.prisma.crossDeployLog.create({
      data: {
        sourceAdvertiserId: input.sourceAdvertiserId,
        sourceAdId: input.sourceAdId,
        targetAdvertiserId,
        mode: 'SMART_PLUS',
        status: 'PENDING',
      },
    });

    try {
      const targetToken = await this.getAccessToken(targetAdvertiserId);
      const targetAdvertiser = await this.prisma.advertiser.findUnique({
        where: { tiktokAdvertiserId: targetAdvertiserId },
        include: { appeal: true },
      });

      if (!targetAdvertiser) {
        throw new Error(`ターゲットアカウント ${targetAdvertiserId} がDBに見つかりません`);
      }

      // i. 動画をターゲットにアップロード
      const videoMapping: Record<string, string> = {};
      for (const videoId of videoIdsToUse) {
        const buffer = videoBuffers.get(videoId)!;
        const newVideoId = await this.tiktokService.uploadVideoToAccount(
          targetAdvertiserId,
          targetToken,
          buffer,
          `cross_deploy_${videoId}.mp4`,
        );
        videoMapping[videoId] = newVideoId;
        await this.tiktokService.waitForVideoReady(targetAdvertiserId, targetToken, newVideoId);
        await new Promise(r => setTimeout(r, 100));
      }

      // ii. 画像をターゲットにアップロード
      const imageMapping: Record<string, string> = {};
      for (const [imageId, buffer] of imageBuffers) {
        const newImageId = await this.tiktokService.uploadImageToAccount(
          targetAdvertiserId,
          targetToken,
          buffer,
          `cross_deploy_${imageId.split('/').pop()}.jpg`,
        );
        imageMapping[imageId] = newImageId;
        await new Promise(r => setTimeout(r, 100));
      }

      const allMediaMapping = { ...videoMapping, ...imageMapping };
      await this.updateLog(log.id, {
        status: 'VIDEOS_UPLOADED',
        videoMapping: allMediaMapping,
      });

      if (input.dryRun) {
        await this.updateLog(log.id, { status: 'COMPLETED' });
        return {
          targetAdvertiserId,
          status: 'SUCCESS',
          mode: 'SMART_PLUS',
          videoMapping: allMediaMapping,
        };
      }

      // iii. UTAGE登録経路を1つ作成
      const utageResult = await this.utageService.createRegistrationPathAndGetUrl(appeal, lpNumber);
      await this.updateLog(log.id, {
        status: 'UTAGE_CREATED',
        utagePath: utageResult.registrationPath,
        destinationUrl: utageResult.destinationUrl,
        crNumber: utageResult.crNumber,
      });

      // 広告名生成
      const adName = this.generateAdName(input, sourceDetail.adName, utageResult.crNumber, lpNumber);
      const dailyBudget = input.dailyBudget || DEFAULT_DAILY_BUDGET[appeal] || 3000;

      // iv. キャンペーン作成
      const campaignId = await this.tiktokService.createSmartPlusCampaign(
        targetAdvertiserId,
        targetToken,
        { campaignName: adName },
      );
      await this.updateLog(log.id, { status: 'CAMPAIGN_CREATED', campaignId });

      // v. 広告グループ作成
      const deepFunnel = DEEP_FUNNEL_CONFIG[appeal];
      const adgroupId = await this.tiktokService.createSmartPlusAdGroup(
        targetAdvertiserId,
        targetToken,
        {
          campaignId,
          adgroupName: this.generateAdGroupName(),
          budget: dailyBudget,
          pixelId: targetAdvertiser.pixelId!,
          deepExternalAction: deepFunnel?.deepExternalAction,
          deepFunnelOptimizationEvent: deepFunnel?.deepFunnelOptimizationEvent,
        },
      );
      await this.updateLog(log.id, { status: 'ADGROUP_CREATED', adgroupId });

      // vi. creative_list構築（動画 + 画像を混合）
      const bcId = targetAdvertiser.identityAuthorizedBcId || undefined;
      const creativeList: Array<{ videoId?: string; imageId?: string; identityId: string; identityType: string; identityAuthorizedBcId?: string }> = [];

      // 動画クリエイティブ
      for (const newVideoId of Object.values(videoMapping)) {
        creativeList.push({
          videoId: newVideoId,
          identityId: targetAdvertiser.identityId!,
          identityType: 'BC_AUTH_TT',
          identityAuthorizedBcId: bcId,
        });
      }

      // 画像クリエイティブ（カルーセル）
      for (const newImageId of Object.values(imageMapping)) {
        creativeList.push({
          imageId: newImageId,
          identityId: targetAdvertiser.identityId!,
          identityType: 'BC_AUTH_TT',
          identityAuthorizedBcId: bcId,
        });
      }

      const landingPageUrl = this.buildLandingPageUrl(utageResult.destinationUrl);
      const adId = await this.tiktokService.createSmartPlusAd(
        targetAdvertiserId,
        targetToken,
        {
          adgroupId,
          adName,
          creativeList,
          adTextList: sourceDetail.adTexts.length > 0 ? sourceDetail.adTexts : [this.getDefaultAdText(appeal)],
          landingPageUrls: [landingPageUrl],
        },
      );

      await this.updateLog(log.id, {
        status: 'COMPLETED',
        adId,
        adName,
        dailyBudget,
      });

      const label = `動画${Object.keys(videoMapping).length}本 + 画像${Object.keys(imageMapping).length}枚`;
      this.logger.log(`Smart+広告作成完了: ${adId} (${label})`);

      return {
        targetAdvertiserId,
        status: 'SUCCESS',
        mode: 'SMART_PLUS',
        campaignId,
        adgroupId,
        adId,
        adName,
        utagePath: utageResult.registrationPath,
        destinationUrl: utageResult.destinationUrl,
        crNumber: utageResult.crNumber,
        dailyBudget,
        videoMapping: allMediaMapping,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.updateLog(log.id, {
        status: 'FAILED',
        errorMessage: errorMsg,
        failedStep: this.getCurrentStep(log),
      });

      return {
        targetAdvertiserId,
        status: 'FAILED',
        mode: 'SMART_PLUS',
        error: errorMsg,
        failedStep: this.getCurrentStep(log),
      };
    }
  }

  /**
   * 通常配信モードの横展開（動画1本 = 広告1本）
   */
  private async deployRegular(
    input: CrossDeployInput,
    targetAdvertiserId: string,
    sourceDetail: Awaited<ReturnType<TiktokService['getSmartPlusAdFullDetail']>>,
    videoId: string,
    videoBuffers: Map<string, Buffer>,
    appeal: string,
    lpNumber: number,
    videoIndex: number,
  ): Promise<CrossDeployResult> {
    const log = await this.prisma.crossDeployLog.create({
      data: {
        sourceAdvertiserId: input.sourceAdvertiserId,
        sourceAdId: input.sourceAdId,
        targetAdvertiserId,
        mode: 'REGULAR',
        status: 'PENDING',
      },
    });

    try {
      const targetToken = await this.getAccessToken(targetAdvertiserId);
      const targetAdvertiser = await this.prisma.advertiser.findUnique({
        where: { tiktokAdvertiserId: targetAdvertiserId },
        include: { appeal: true },
      });

      if (!targetAdvertiser) {
        throw new Error(`ターゲットアカウント ${targetAdvertiserId} がDBに見つかりません`);
      }

      // i. 動画をアップロード
      const buffer = videoBuffers.get(videoId)!;
      const newVideoId = await this.tiktokService.uploadVideoToAccount(
        targetAdvertiserId,
        targetToken,
        buffer,
        `cross_deploy_${videoId}.mp4`,
      );
      const videoMapping = { [videoId]: newVideoId };
      await this.tiktokService.waitForVideoReady(targetAdvertiserId, targetToken, newVideoId);

      await this.updateLog(log.id, { status: 'VIDEOS_UPLOADED', videoMapping });

      if (input.dryRun) {
        await this.updateLog(log.id, { status: 'COMPLETED' });
        return {
          targetAdvertiserId,
          status: 'SUCCESS',
          mode: 'REGULAR',
          videoMapping,
        };
      }

      // ii. UTAGE登録経路を1つ作成（動画ごとにCR番号が連番）
      const utageResult = await this.utageService.createRegistrationPathAndGetUrl(appeal, lpNumber);
      await this.updateLog(log.id, {
        status: 'UTAGE_CREATED',
        utagePath: utageResult.registrationPath,
        destinationUrl: utageResult.destinationUrl,
        crNumber: utageResult.crNumber,
      });

      const adName = this.generateAdName(input, sourceDetail.adName, utageResult.crNumber, lpNumber);
      const dailyBudget = input.dailyBudget || DEFAULT_DAILY_BUDGET[appeal] || 3000;

      // iii. キャンペーン作成（通常配信）
      const advertiserUuid = targetAdvertiser.id;
      const campaignResp = await this.tiktokService.createCampaign(
        targetAdvertiserId,
        targetToken,
        adName,
        'LEAD_GENERATION',
        'BUDGET_MODE_INFINITE',
        undefined,
        advertiserUuid,
      );
      const campaignId = String(campaignResp.data?.campaign_id);
      await this.updateLog(log.id, { status: 'CAMPAIGN_CREATED', campaignId });

      // iv. 広告グループ作成（通常配信）
      const adgroupName = this.generateAdGroupName();

      // 除外オーディエンス構築
      const excludedAudiences: string[] = [];
      const exclusionMap: Record<string, string> = {
        '7468288053866561553': '194405484', // AI_1
        '7523128243466551303': '194405486', // AI_2
        '7543540647266074641': '194405488', // AI_3
        '7580666710525493255': '194416060', // AI_4
      };
      if (exclusionMap[targetAdvertiserId]) {
        excludedAudiences.push(exclusionMap[targetAdvertiserId]);
      }
      if (appeal === 'AI') {
        excludedAudiences.push('194977234'); // AIオプトイン（全期間）
      }

      const adgroupResp = await this.tiktokService.createAdGroup(
        targetAdvertiserId,
        campaignId,
        adgroupName,
        {
          placementType: 'PLACEMENT_TYPE_NORMAL',
          placements: ['PLACEMENT_TIKTOK'],
          budgetMode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
          budget: dailyBudget,
          bidType: 'BID_TYPE_NO_BID',
          optimizationGoal: 'CONVERT',
          pixelId: targetAdvertiser.pixelId!,
          optimizationEvent: 'ON_WEB_REGISTER',
          commentDisabled: true,
          targeting: {
            location_ids: ['1861060'],
            age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'],
            gender: 'GENDER_UNLIMITED',
            languages: ['ja'],
            excluded_custom_audiences: excludedAudiences.length > 0 ? excludedAudiences : undefined,
          },
        },
        targetToken,
      );
      const adgroupId = String(adgroupResp.data?.adgroup_id);
      await this.updateLog(log.id, { status: 'ADGROUP_CREATED', adgroupId });

      // v. サムネイル画像をアップロード
      const thumbnailImageId = await this.tiktokService.uploadVideoThumbnail(
        targetAdvertiserId,
        targetToken,
        newVideoId,
      );

      // vi. 広告作成（通常配信 1-1-1）
      const landingPageUrl = this.buildLandingPageUrl(utageResult.destinationUrl);
      const adResp = await this.tiktokService.createAd(
        targetAdvertiserId,
        adgroupId,
        adName,
        {
          identity: targetAdvertiser.identityId!,
          identityType: 'BC_AUTH_TT',
          identityAuthorizedBcId: targetAdvertiser.identityAuthorizedBcId || undefined,
          videoId: newVideoId,
          imageIds: [thumbnailImageId],
          adText: sourceDetail.adTexts[0] || this.getDefaultAdText(appeal),
          callToAction: 'LEARN_MORE',
          landingPageUrl,
        },
        targetToken,
      );
      const adId = String(adResp.data?.ad_ids?.[0] || adResp.data?.ad_id);

      await this.updateLog(log.id, {
        status: 'COMPLETED',
        adId,
        adName,
        dailyBudget,
      });

      return {
        targetAdvertiserId,
        status: 'SUCCESS',
        mode: 'REGULAR',
        campaignId,
        adgroupId,
        adId,
        adName,
        utagePath: utageResult.registrationPath,
        destinationUrl: utageResult.destinationUrl,
        crNumber: utageResult.crNumber,
        dailyBudget,
        videoMapping,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.updateLog(log.id, {
        status: 'FAILED',
        errorMessage: errorMsg,
        failedStep: this.getCurrentStep(log),
      });

      return {
        targetAdvertiserId,
        status: 'FAILED',
        mode: 'REGULAR',
        error: errorMsg,
        failedStep: this.getCurrentStep(log),
      };
    }
  }

  /**
   * 途中失敗からの再開
   */
  async resumeFailedDeploy(logId: string): Promise<CrossDeployResult> {
    const log = await this.prisma.crossDeployLog.findUnique({ where: { id: logId } });
    if (!log) throw new Error(`CrossDeployLog not found: ${logId}`);
    if (log.status !== 'FAILED') throw new Error(`ログのステータスがFAILEDではありません: ${log.status}`);

    // 失敗したステップに応じて再開ポイントを決定
    const input: CrossDeployInput = {
      sourceAdvertiserId: log.sourceAdvertiserId,
      sourceAdId: log.sourceAdId,
      targetAdvertiserIds: [log.targetAdvertiserId],
      mode: log.mode as any,
    };

    // 簡易実装: 最初から再実行
    const results = await this.crossDeploy(input);
    return results[0];
  }

  // ========== ヘルパーメソッド ==========

  private async getAccessToken(advertiserId: string): Promise<string> {
    const token = await this.prisma.oAuthToken.findUnique({
      where: { advertiserId },
    });
    if (!token) throw new Error(`アクセストークンが見つかりません: ${advertiserId}`);
    return token.accessToken;
  }

  private async updateLog(logId: string, data: any): Promise<void> {
    await this.prisma.crossDeployLog.update({
      where: { id: logId },
      data,
    });
  }

  private getCurrentStep(log: any): string {
    const statusToStep: Record<string, string> = {
      'PENDING': 'VIDEO_UPLOAD',
      'VIDEOS_UPLOADED': 'UTAGE_CREATE',
      'UTAGE_CREATED': 'CAMPAIGN_CREATE',
      'CAMPAIGN_CREATED': 'ADGROUP_CREATE',
      'ADGROUP_CREATED': 'AD_CREATE',
    };
    return statusToStep[log.status] || 'UNKNOWN';
  }

  /**
   * 広告名からappealとLP番号を推測
   */
  private parseAdNameForAppeal(
    adName: string,
    sourceAdvertiserId: string,
  ): { appeal: string; lpNumber: number } {
    // 広告名パターン: YYMMDD/制作者名/CR名/LP名-CR12345
    // LP名から "LP1", "LP2" 等を抽出
    const lpMatch = adName.match(/LP(\d+)/i);
    const lpNumber = lpMatch ? parseInt(lpMatch[1]) : 1;

    // appealはアカウントのappealから取得
    // 同期的に取得できないのでAdvertiserテーブルから推測
    const aiAccounts = ['7468288053866561553', '7523128243466551303', '7543540647266074641', '7580666710525493255'];
    const snsAccounts = ['7247073333517238273', '7543540100849156112', '7543540381615800337'];
    const spAccounts = ['7474920444831875080', '7592868952431362066', '7616545514662051858'];

    let appeal = 'AI';
    if (snsAccounts.includes(sourceAdvertiserId)) appeal = 'SNS';
    else if (spAccounts.includes(sourceAdvertiserId)) appeal = 'スキルプラス';

    // 広告名にも手がかりがある場合
    if (adName.includes('SNS') || adName.includes('sns')) appeal = 'SNS';
    else if (adName.includes('スキル') || adName.includes('セミナー')) appeal = 'スキルプラス';

    return { appeal, lpNumber };
  }

  /**
   * 横展開用の広告名を生成
   */
  private generateAdName(
    input: CrossDeployInput,
    sourceAdName: string,
    crNumber: number,
    lpNumber: number,
  ): string {
    if (input.adNameOverride) return input.adNameOverride;

    // YYMMDD（JST）
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const dateStr = `${String(jst.getUTCFullYear()).slice(2)}${String(jst.getUTCMonth() + 1).padStart(2, '0')}${String(jst.getUTCDate()).padStart(2, '0')}`;

    // 元広告名から制作者名/CR名を抽出
    const parts = sourceAdName.split('/');
    const creator = parts.length >= 2 ? parts[1] : '横展開';
    const crName = parts.length >= 3 ? parts[2] : '横展開CR';

    const crStr = String(crNumber).padStart(5, '0');
    return `${dateStr}/${creator}/${crName}/LP${lpNumber}-CR${crStr}`;
  }

  /**
   * 広告グループ名を生成（YYMMDD ノンタゲ）
   */
  private generateAdGroupName(): string {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const dateStr = `${String(jst.getUTCFullYear()).slice(2)}${String(jst.getUTCMonth() + 1).padStart(2, '0')}${String(jst.getUTCDate()).padStart(2, '0')}`;
    return `${dateStr} ノンタゲ`;
  }

  /**
   * UTM付きLP URLを構築
   */
  private buildLandingPageUrl(destinationUrl: string): string {
    const separator = destinationUrl.includes('?') ? '&' : '?';
    return `${destinationUrl}${separator}utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
  }

  /**
   * デフォルト広告文を取得
   */
  private getDefaultAdText(appeal: string): string {
    if (appeal === 'SNS') {
      return 'SNSで独立するなら学んでおきたい本質のSNSマーケ特商法（https://skill.addness.co.jp/tokushoho）';
    }
    if (appeal === 'スキルプラス') {
      return 'スキルで独立するなら学んでおきたい本質のスキル活用術特商法（https://skill.addness.co.jp/tokushoho）';
    }
    return 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';
  }
}
