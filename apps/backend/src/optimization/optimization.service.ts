import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TiktokService } from '../tiktok/tiktok.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { AppealService } from '../appeal/appeal.service';
import { AdBudgetCapService } from '../ad-performance/ad-budget-cap.service';
import { NotificationService } from '../notification/notification.service';
import { ConfigService } from '@nestjs/config';
import {
  validateAppealSettings,
  validateAdNameFormat,
  classifyOptimizationError,
  logOptimizationError,
  OptimizationErrorType,
  withDatabaseRetry,
  classifyDatabaseError,
  logDatabaseError,
} from '../common/utils';

interface AdPerformance {
  adId: string;
  adName: string;
  adgroupId: string;
  campaignId: string;
  advertiserId: string;
  status: string;
  impressions: number;
  clicks: number;
  spend: number;
  cvCount: number;
  frontSalesCount: number;
  cpa: number;
  frontCPO: number;
  registrationPath: string;
  appealName: string;
  isSmartPlus?: boolean; // 新スマートプラス広告フラグ
}

interface CampaignPerformance {
  campaignId: string;
  campaignName: string;
  lpName: string;
  registrationPath: string;
  impressions: number;
  clicks: number;
  spend: number;
  cvCount: number;
  frontSalesCount: number;
  cpa: number;
  frontCPO: number;
}

interface OptimizationDecision {
  adId: string;
  adName: string;
  adgroupId: string;
  campaignId: string;
  action: 'PAUSE' | 'CONTINUE' | 'INCREASE_BUDGET';
  reason: string;
  currentBudget?: number;
  newBudget?: number;
  performance?: AdPerformance; // 追加：パフォーマンス情報
  isSmartPlus?: boolean; // 新スマートプラス広告フラグ
}

interface CampaignOptimizationDecision {
  campaignId: string;
  campaignName: string;
  action: 'PAUSE' | 'CONTINUE' | 'INCREASE_BUDGET';
  reason: string;
  currentBudget?: number;
  newBudget?: number;
  performance?: CampaignPerformance;
}

@Injectable()
export class OptimizationService {
  private readonly logger = new Logger(OptimizationService.name);

  constructor(
    private prisma: PrismaService,
    private tiktokService: TiktokService,
    private googleSheetsService: GoogleSheetsService,
    private appealService: AppealService,
    private adBudgetCapService: AdBudgetCapService,
    private notificationService: NotificationService,
    private configService: ConfigService,
  ) {}

  /**
   * ad_nameがクリエイティブ名（ファイル名）かどうかを判定
   * CR名には.mp4, .jpg, .png などの拡張子が含まれる
   */
  private isCreativeName(adName: string | null | undefined): boolean {
    if (!adName) return false;

    const videoExtensions = ['.mp4', '.MP4', '.mov', '.MOV', '.avi', '.AVI'];
    const imageExtensions = ['.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.gif', '.GIF'];
    const allExtensions = [...videoExtensions, ...imageExtensions];

    return allExtensions.some(ext => adName.includes(ext));
  }

  /**
   * 予算調整を実行（全Advertiser対象）
   */
  async executeOptimization(accessToken: string) {
    this.logger.log('Starting budget optimization for all advertisers');

    const advertiserIds = await this.getActiveAdvertiserIds();
    const results: any[] = [];

    for (const advertiserId of advertiserIds) {
      try {
        const result = await this.optimizeAdvertiser(advertiserId, accessToken);
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to optimize advertiser ${advertiserId}:`, error);
        results.push({
          advertiserId,
          success: false,
          error: error.message,
        });
      }
    }

    return {
      success: true,
      results,
    };
  }

  /**
   * 特定Advertiserの予算調整を実行
   */
  async optimizeAdvertiser(advertiserId: string, accessToken: string) {
    this.logger.log(`Optimizing advertiser: ${advertiserId}`);

    // Google Sheetsのキャッシュをクリアして最新データを取得
    this.googleSheetsService.clearCache();

    // 訴求情報を取得
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: advertiserId },
      include: {
        appeal: true,
      },
    });

    if (!advertiser) {
      // O-03: Advertiser未検出
      const error = new Error(`Advertiser ${advertiserId} not found`);
      const errorInfo = classifyOptimizationError(error, { entityId: advertiserId });
      logOptimizationError(this.logger, errorInfo, 'optimizeAdvertiser');
      throw error;
    }

    if (!advertiser.appeal) {
      // O-02: Appeal未設定
      const error = new Error(`No appeal assigned to advertiser ${advertiserId}`);
      const errorInfo = classifyOptimizationError(error, { entityId: advertiserId });
      logOptimizationError(this.logger, errorInfo, 'optimizeAdvertiser');
      throw error;
    }

    const appeal = advertiser.appeal;

    // O-04: 目標CPA/CPO設定の検証
    const appealValidation = validateAppealSettings(appeal);
    if (!appealValidation.isValid) {
      this.logger.warn(
        `[O-04] Appeal設定不完全 (advertiserId: ${advertiserId}): 未設定フィールド: ${appealValidation.missingFields.join(', ')}`,
      );
      // 警告を出力するが処理は継続（デフォルト値が使用される可能性あり）
    }

    // ========================================
    // Phase 1: 広告レベルの予算調整（広告名がある広告）
    // ========================================
    this.logger.log('========================================');
    this.logger.log('Phase 1: Evaluating ads with ad_name (manual campaigns)');
    this.logger.log('========================================');

    // 配信中の広告を取得
    const activeAds = await this.getActiveAds(advertiserId, accessToken);
    this.logger.log(`Found ${activeAds.length} active ads for advertiser ${advertiserId}`);

    // 処理済みキャンペーンIDを記録
    const processedCampaigns = new Set<string>();

    // 各広告のパフォーマンスを評価（広告名がある広告のみ）
    const adPerformances: AdPerformance[] = [];
    for (const ad of activeAds) {
      // 広告名がない場合はスキップ（Phase 2で処理）
      if (!ad.ad_name || ad.ad_name.trim() === '') {
        this.logger.debug(`Ad ${ad.ad_id} has no ad_name, skipping in Phase 1`);
        continue;
      }

      // CR名（拡張子含む）の場合は旧スマプラなのでPhase 2で処理
      // ただし、新スマートプラス広告（isSmartPlus=true）の場合は、Phase 1で処理
      if (this.isCreativeName(ad.ad_name) && !ad.isSmartPlus) {
        this.logger.debug(
          `Ad ${ad.ad_id} has creative name (${ad.ad_name}), skipping in Phase 1 (will be processed as Smart+ legacy in Phase 2)`
        );
        continue;
      }

      // このキャンペーンは通常キャンペーン（または新スマプラ）としてマーク
      processedCampaigns.add(ad.campaign_id);

      try {
        const performance = await this.evaluateAdPerformance(ad, appeal, accessToken);
        if (performance) {
          adPerformances.push(performance);
        }
      } catch (error) {
        this.logger.error(`Failed to evaluate ad ${ad.ad_id} (${ad.ad_name}):`, error.message);
        this.logger.error(`Error stack: ${error.stack}`);
      }
    }

    this.logger.log(`Successfully evaluated ${adPerformances.length} ads out of ${activeAds.length} active ads`);

    // 最適化判断を実行
    const decisions: OptimizationDecision[] = [];
    for (const performance of adPerformances) {
      const decision = await this.makeOptimizationDecision(performance, appeal);
      decisions.push(decision);
    }

    // 広告セットごとにグループ化して実行
    const adgroupDecisions = this.groupDecisionsByAdGroup(decisions);
    const executionResults: any[] = [];

    for (const [adgroupId, adDecisions] of Object.entries(adgroupDecisions)) {
      try {
        const result = await this.executeAdGroupOptimization(
          adgroupId,
          adDecisions,
          advertiserId,
          accessToken,
        );
        executionResults.push(result);
      } catch (error) {
        this.logger.error(`Failed to optimize adgroup ${adgroupId}:`, error);
        executionResults.push({
          adgroupId,
          action: 'ERROR',
          reason: `実行エラー: ${error.message}`,
          error: error.message,
        });
      }
    }

    // 各広告の詳細ログを作成
    const detailedLogs = decisions.map(decision => ({
      adId: decision.adId,
      adName: decision.adName,
      adgroupId: decision.adgroupId,
      action: decision.action,
      reason: decision.reason,
      currentBudget: decision.currentBudget,
      newBudget: decision.newBudget,
      metrics: {
        cpa: decision.performance?.cpa,
        frontCpo: decision.performance?.frontCPO,
        cvCount: decision.performance?.cvCount,
        frontSalesCount: decision.performance?.frontSalesCount,
        spend: decision.performance?.spend,
        impressions: decision.performance?.impressions,
        clicks: decision.performance?.clicks,
      },
      targets: {
        targetCPA: appeal.targetCPA,
        allowableCPA: appeal.allowableCPA,
        targetFrontCPO: appeal.targetFrontCPO,
        allowableFrontCPO: appeal.allowableFrontCPO,
      }
    }));

    this.logger.log(`Phase 1 completed: Processed ${processedCampaigns.size} campaigns with named ads`);

    // ========================================
    // Phase 2: キャンペーンレベルの予算調整（旧スマートプラス）
    // ========================================
    this.logger.log('========================================');
    this.logger.log('Phase 2: Evaluating campaigns without ad_name (Smart+ legacy)');
    this.logger.log('========================================');

    const activeCampaigns = await this.getActiveCampaigns(advertiserId, accessToken);
    let smartPlusCampaignCount = 0;
    const campaignExecutionResults: any[] = [];

    for (const campaign of activeCampaigns) {
      // Phase 1で処理済みのキャンペーンはスキップ（通常キャンペーン）
      if (processedCampaigns.has(campaign.campaign_id)) {
        this.logger.debug(
          `Campaign ${campaign.campaign_id} (${campaign.campaign_name}) already processed as manual campaign, skipping`
        );
        continue;
      }

      // キャンペーン配下の広告を確認
      const campaignAds = await this.getAdsForCampaign(
        advertiserId,
        accessToken,
        campaign.campaign_id
      );

      // 全広告がCR名（拡張子含む）かどうかをチェック
      const allAdsHaveCreativeNames = campaignAds.length > 0 && campaignAds.every(
        (ad: any) => this.isCreativeName(ad.ad_name)
      );

      // CR名でない広告名（手動の広告名）を持つ広告が1つでもあれば通常/新スマプラキャンペーン
      const hasManualAdNames = campaignAds.some(
        (ad: any) => ad.ad_name && ad.ad_name.trim() !== '' && !this.isCreativeName(ad.ad_name)
      );

      if (hasManualAdNames) {
        this.logger.debug(
          `Campaign ${campaign.campaign_id} (${campaign.campaign_name}) has manual ad names (not creative names), skipping in Phase 2`
        );
        continue;
      }

      // 全広告がCR名でない場合（空の広告名のみ）もスキップ
      if (!allAdsHaveCreativeNames) {
        this.logger.debug(
          `Campaign ${campaign.campaign_id} (${campaign.campaign_name}) does not have all creative names, skipping in Phase 2`
        );
        continue;
      }

      // ここまで来たら：全広告がCR名（拡張子含む） = 旧スマートプラス候補
      // キャンペーン名をパースしてみる
      const parsedName = this.parseAdName(campaign.campaign_name);

      if (!parsedName) {
        this.logger.warn(
          `Campaign ${campaign.campaign_id} (${campaign.campaign_name}) has no named ads but campaign name is unparseable, skipping`
        );
        continue;
      }

      // ここから旧スマートプラスの評価
      this.logger.log(
        `✓ Detected Smart+ legacy campaign: ${campaign.campaign_id} (${campaign.campaign_name})`
      );
      smartPlusCampaignCount++;

      try {
        const performance = await this.evaluateCampaignPerformance(
          campaign,
          appeal,
          accessToken
        );

        if (!performance) {
          this.logger.warn(`Failed to evaluate campaign ${campaign.campaign_id}, skipping`);
          continue;
        }

        const decision = await this.makeCampaignOptimizationDecision(performance, appeal);

        // 判定に応じてアクションを実行
        if (decision.action === 'PAUSE') {
          await this.pauseCampaign(
            campaign.campaign_id,
            advertiserId,
            accessToken,
            decision.reason
          );
          campaignExecutionResults.push({
            campaignId: campaign.campaign_id,
            campaignName: campaign.campaign_name,
            action: 'PAUSE',
            reason: decision.reason,
          });
        } else if (decision.action === 'INCREASE_BUDGET') {
          // キャンペーン配下の広告セットを取得
          const adgroups = await this.tiktokService.getAdGroups(
            advertiserId,
            accessToken,
            [campaign.campaign_id]  // 配列として渡す
          );

          if (adgroups.data?.list?.length > 0) {
            const adgroupId = adgroups.data.list[0].adgroup_id;

            // 既存のincreaseBudgetメソッドが自動で判定
            await this.increaseBudget(
              adgroupId,
              advertiserId,
              accessToken,
              0.3,  // 30%増額
            );
            campaignExecutionResults.push({
              campaignId: campaign.campaign_id,
              campaignName: campaign.campaign_name,
              action: 'INCREASE_BUDGET',
              reason: decision.reason,
            });
          } else {
            this.logger.warn(`No adgroups found for campaign ${campaign.campaign_id}, skipping budget increase`);
          }
        } else {
          // CONTINUE
          campaignExecutionResults.push({
            campaignId: campaign.campaign_id,
            campaignName: campaign.campaign_name,
            action: 'CONTINUE',
            reason: decision.reason,
          });
        }
      } catch (error) {
        this.logger.error(`Failed to optimize campaign ${campaign.campaign_id}:`, error);
        campaignExecutionResults.push({
          campaignId: campaign.campaign_id,
          campaignName: campaign.campaign_name,
          action: 'ERROR',
          reason: `実行エラー: ${error.message}`,
          error: error.message,
        });
      }
    }

    this.logger.log(
      `Phase 2 completed: Processed ${smartPlusCampaignCount} Smart+ legacy campaigns`
    );
    this.logger.log(`Optimization completed for advertiser: ${advertiserId}`);

    return {
      advertiserId,
      success: true,
      totalAds: activeAds.length,
      evaluated: adPerformances.length,
      decisions: decisions.length,
      executed: executionResults.length,
      results: executionResults,
      detailedLogs, // 追加：各広告の詳細ログ
      // Phase 2の結果を追加
      smartPlusCampaigns: {
        total: smartPlusCampaignCount,
        results: campaignExecutionResults,
      },
    };
  }

  /**
   * 配信中の広告を取得（通常広告 + 新スマートプラス広告）
   */
  private async getActiveAds(advertiserId: string, accessToken: string) {
    // 新スマートプラス広告を取得
    const smartPlusAdsResponse = await this.tiktokService.getSmartPlusAds(advertiserId, accessToken);
    const smartPlusAds = smartPlusAdsResponse.data?.list?.filter((ad: any) => ad.operation_status === 'ENABLE') || [];

    // 新スマートプラス広告のIDセットを作成
    const smartPlusAdIds = new Set(smartPlusAds.map((ad: any) => ad.smart_plus_ad_id));

    // 通常の広告を取得
    const adsResponse = await this.tiktokService.getAds(advertiserId, accessToken);
    const allRegularAds = adsResponse.data?.list?.filter((ad: any) => ad.operation_status === 'ENABLE') || [];

    // 通常の広告から新スマートプラス広告を除外（重複を避ける）
    // 通常のad/getでも新スマートプラス広告が返ってくるが、広告名がクリエイティブ名になっているため除外
    const regularAdsOnly = allRegularAds.filter((ad: any) => {
      // ad.ad_idまたはad.smart_plus_ad_idが新スマートプラス広告に含まれていない場合のみ残す
      return !smartPlusAdIds.has(ad.ad_id) && !smartPlusAdIds.has(ad.smart_plus_ad_id);
    });

    // 新スマートプラス広告を処理
    smartPlusAds.forEach((ad: any) => {
      ad.isSmartPlus = true;
      // smart_plus_ad_id を ad_id としても保存（メトリクス取得に使用）
      if (!ad.ad_id) {
        ad.ad_id = ad.smart_plus_ad_id;
      }
      // /smart_plus/ad/get/ からの ad_name は正しい手動設定名なので、そのまま使う
    });

    // 両方の広告を結合
    const allActiveAds = [...regularAdsOnly, ...smartPlusAds];

    this.logger.log(`Active ads count: ${allActiveAds.length} (Regular: ${regularAdsOnly.length}, Smart+: ${smartPlusAds.length})`);
    if (allActiveAds.length > 0) {
      this.logger.log(`Sample ad names: ${allActiveAds.slice(0, 3).map((ad: any) => `${ad.ad_name}${ad.isSmartPlus ? ' [Smart+]' : ''}`).join(', ')}`);
    }

    return allActiveAds;
  }

  /**
   * 広告のパフォーマンスを評価
   */
  private async evaluateAdPerformance(
    ad: any,
    appeal: any,
    accessToken: string,
  ): Promise<AdPerformance | null> {
    this.logger.log(`Evaluating ad: ${ad.ad_id}, name: ${ad.ad_name}`);

    // 広告名をパース
    const parsedName = this.parseAdName(ad.ad_name);
    if (!parsedName) {
      this.logger.warn(`Invalid ad name format, skipping ad: ${ad.ad_name}`);
      return null;
    }

    this.logger.log(`Parsed ad name successfully: ${JSON.stringify(parsedName)}`);

    // 登録経路を生成
    const registrationPath = this.generateRegistrationPath(parsedName.lpName, appeal.name);

    // 過去7日間の期間を計算（当日は含めない）
    const { startDate, endDate } = this.calculateEvaluationPeriod();

    // TikTok APIから過去7日間のメトリクスを取得
    const metrics = await this.getAdMetrics(ad.ad_id, startDate, endDate);

    // スプレッドシートからCV数とフロント販売本数を取得
    const cvCount = await this.googleSheetsService.getCVCount(
      appeal.name,
      appeal.cvSpreadsheetUrl,
      registrationPath,
      startDate,
      endDate,
    );

    const frontSalesCount = await this.googleSheetsService.getFrontSalesCount(
      appeal.name,
      appeal.frontSpreadsheetUrl,
      registrationPath,
      startDate,
      endDate,
    );

    // CPAとフロントCPOを計算
    const cpa = cvCount > 0 ? metrics.spend / cvCount : 0;
    const frontCPO = frontSalesCount > 0 ? metrics.spend / frontSalesCount : 0;

    return {
      adId: ad.ad_id,
      adName: ad.ad_name,
      adgroupId: ad.adgroup_id,
      campaignId: ad.campaign_id,
      advertiserId: ad.advertiser_id,
      status: ad.operation_status,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      spend: metrics.spend,
      cvCount,
      frontSalesCount,
      cpa,
      frontCPO,
      registrationPath,
      appealName: appeal.name,
      isSmartPlus: ad.isSmartPlus || false, // 新スマートプラス広告フラグを追加
    };
  }

  /**
   * 広告名をパース（O-01対応: エラー検出強化）
   * 形式: 出稿日/制作者名/CR名/LP名-番号
   * CR名は複数パートに分かれることがある（例: 問題ないです/ひったくりVer_リール投稿）
   */
  private parseAdName(adName: string): { date: string; creator: string; creativeName: string; lpName: string } | null {
    // O-01: 広告名形式検証
    const validation = validateAdNameFormat(adName);

    if (!validation.isValid) {
      // 警告ログを出力（validateAdNameFormatが詳細なエラー情報を提供）
      if (validation.warning) {
        logOptimizationError(this.logger, validation.warning, 'parseAdName');
      }
      return null;
    }

    return validation.parsed!;
  }

  /**
   * 登録経路を生成
   * 形式: TikTok広告-訴求-LP名および番号
   */
  private generateRegistrationPath(lpName: string, appealName: string): string {
    return `TikTok広告-${appealName}-${lpName}`;
  }

  /**
   * 評価期間を計算（過去7日間、当日は含めない）
   * JST基準で正しく計算
   */
  private calculateEvaluationPeriod(): { startDate: Date; endDate: Date } {
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000; // JSTはUTC+9時間
    const jstNow = new Date(now.getTime() + jstOffset);

    // JST基準で昨日の終わりと7日前の始まりを計算
    const endDate = new Date(jstNow);
    endDate.setUTCDate(endDate.getUTCDate() - 1); // 昨日
    endDate.setUTCHours(23, 59, 59, 999); // その日の終わりまで含める

    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 6); // 7日前
    startDate.setUTCHours(0, 0, 0, 0); // その日の始まりから

    return { startDate, endDate };
  }

  /**
   * 広告のメトリクスを取得（過去7日間）
   * @param tiktokAdId TikTok APIから返される広告ID
   */
  private async getAdMetrics(tiktokAdId: string, startDate: Date, endDate: Date) {
    this.logger.debug(`Getting metrics for ad ${tiktokAdId} from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // まずTikTok IDからAdレコードを検索（AdGroupも含めてSmart+判定用）
    const ad = await this.prisma.ad.findUnique({
      where: { tiktokId: tiktokAdId },
      include: {
        adGroup: true,
      },
    });

    if (!ad) {
      this.logger.warn(`Ad not found in DB for tiktokId: ${tiktokAdId}`);
      return {
        impressions: 0,
        clicks: 0,
        spend: 0,
      };
    }

    this.logger.debug(`Found ad in DB: ${ad.id} (tiktokId: ${tiktokAdId})`);

    // Smart+広告かどうかを判定
    const isSmartPlus = ad.adGroup.bidType === 'BID_TYPE_NO_BID';

    let metrics;
    if (isSmartPlus) {
      // Smart+広告の場合：最新の1レコードのみを使用（既に7日間の合算値）
      this.logger.debug(`Smart+ ad detected, using latest single metric record`);
      metrics = await this.prisma.metric.findMany({
        where: {
          adId: ad.id,
          statDate: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: { statDate: 'desc' },
        take: 1,
      });
    } else {
      // 通常広告の場合：期間内の全レコードを取得
      this.logger.debug(`Regular ad detected, fetching all metrics in period`);
      metrics = await this.prisma.metric.findMany({
        where: {
          adId: ad.id,
          statDate: {
            gte: startDate,
            lte: endDate,
          },
        },
      });
    }

    this.logger.log(`Found ${metrics.length} metrics for ad ${tiktokAdId} (${ad.id}) [${isSmartPlus ? 'Smart+' : 'Regular'}]`);

    if (metrics.length > 0) {
      this.logger.debug(`Sample metric values: impressions=${metrics[0].impressions}, clicks=${metrics[0].clicks}, spend=${metrics[0].spend}`);
    }

    // 合計を計算（Smart+の場合は1レコードのみなので実質そのまま、通常広告は7日分の合計）
    const totalImpressions = metrics.reduce((sum, m) => sum + m.impressions, 0);
    const totalClicks = metrics.reduce((sum, m) => sum + (m.clicks || 0), 0);
    const totalSpend = metrics.reduce((sum, m) => sum + m.spend, 0);

    this.logger.debug(`Total metrics: impressions=${totalImpressions}, clicks=${totalClicks}, spend=${totalSpend}`);

    return {
      impressions: totalImpressions,
      clicks: totalClicks,
      spend: totalSpend,
    };
  }

  /**
   * 最適化判断を実行
   */
  private async makeOptimizationDecision(
    performance: AdPerformance,
    appeal: any,
  ): Promise<OptimizationDecision> {
    const { impressions, spend, cvCount, frontSalesCount, cpa, frontCPO } = performance;
    const { allowableCPA, targetCPA, allowableFrontCPO, targetFrontCPO } = appeal;

    // ヘルパー関数：decisionにperformanceを追加
    const createDecision = (action: 'PAUSE' | 'CONTINUE' | 'INCREASE_BUDGET', reason: string, currentBudget?: number, newBudget?: number): OptimizationDecision => ({
      adId: performance.adId,
      adName: performance.adName,
      adgroupId: performance.adgroupId,
      campaignId: performance.campaignId,
      action,
      reason,
      currentBudget,
      newBudget,
      performance,
      isSmartPlus: performance.isSmartPlus,
    });

    // 5000インプレッション未達の場合
    if (impressions < 5000) {
      return createDecision('CONTINUE', `インプレッション数が5000未満（${impressions}）のため、継続配信`);
    }

    // フロント販売が1件以上ある場合
    if (frontSalesCount >= 1) {
      if (frontCPO <= targetFrontCPO) {
        return createDecision('INCREASE_BUDGET', `フロントCPO（¥${frontCPO.toFixed(0)}）が目標値（¥${targetFrontCPO}）以下のため、予算30%増額`);
      } else if (frontCPO <= allowableFrontCPO) {
        return createDecision('CONTINUE', `フロントCPO（¥${frontCPO.toFixed(0)}）が許容値（¥${allowableFrontCPO}）以下のため、継続配信`);
      } else {
        return createDecision('PAUSE', `フロントCPO（¥${frontCPO.toFixed(0)}）が許容値（¥${allowableFrontCPO}）を超過のため、停止`);
      }
    }

    // フロント販売が0件の場合
    if (frontSalesCount === 0) {
      // 全期間の広告費を取得
      const totalSpend = await this.getTotalAdSpend(performance.adId);

      // CPA = 0の場合はCV数が0なので停止
      if (cpa === 0) {
        return createDecision('PAUSE', `CV数が0（CPA=0）のため、停止`);
      }

      if (cpa <= allowableCPA && totalSpend <= allowableFrontCPO) {
        return createDecision('CONTINUE', `CPA（¥${cpa.toFixed(0)}）が許容値以下かつ累積広告費（¥${totalSpend.toFixed(0)}）が許容フロントCPO以下のため、継続配信`);
      } else {
        return createDecision('PAUSE', `CPA（¥${cpa.toFixed(0)}）が許容値を超過または累積広告費が許容フロントCPOを超過のため、停止`);
      }
    }

    // デフォルトは継続
    return createDecision('CONTINUE', '判定基準に該当せず、継続配信');
  }

  /**
   * 広告の累積広告費を取得
   */
  private async getTotalAdSpend(adId: string): Promise<number> {
    const metrics = await this.prisma.metric.findMany({
      where: { adId },
    });

    return metrics.reduce((sum, m) => sum + m.spend, 0);
  }

  /**
   * 広告セットごとに判断をグループ化
   */
  private groupDecisionsByAdGroup(
    decisions: OptimizationDecision[],
  ): Record<string, OptimizationDecision[]> {
    const grouped: Record<string, OptimizationDecision[]> = {};

    for (const decision of decisions) {
      if (!grouped[decision.adgroupId]) {
        grouped[decision.adgroupId] = [];
      }
      grouped[decision.adgroupId].push(decision);
    }

    return grouped;
  }

  /**
   * 広告セット単位で最適化を実行
   */
  private async executeAdGroupOptimization(
    adgroupId: string,
    decisions: OptimizationDecision[],
    advertiserId: string,
    accessToken: string,
  ) {
    this.logger.log(`Executing optimization for adgroup: ${adgroupId}`);

    // まず配信停止の広告を処理
    const pauseDecisions = decisions.filter((d) => d.action === 'PAUSE');
    for (const decision of pauseDecisions) {
      await this.pauseAd(decision.adId, decision.adgroupId, advertiserId, accessToken, decision.reason);
    }

    // 残りの判断を確認
    const remainingDecisions = decisions.filter((d) => d.action !== 'PAUSE');

    if (remainingDecisions.length === 0) {
      return {
        adgroupId,
        action: 'NO_CHANGE',
        reason: '全ての広告が停止されました',
      };
    }

    // 予算増額の広告が1つでもあれば予算を増額
    const increaseBudgetDecisions = remainingDecisions.filter((d) => d.action === 'INCREASE_BUDGET');

    if (increaseBudgetDecisions.length > 0) {
      // 新スマートプラス広告かどうかを判定（1つでもスマプラ広告があればスマプラとして処理）
      const isSmartPlus = increaseBudgetDecisions.some((d) => d.isSmartPlus);
      const campaignId = increaseBudgetDecisions[0].campaignId;

      if (isSmartPlus) {
        this.logger.log(`Smart+ ad detected for adgroup ${adgroupId}, using Smart+ budget update API`);
        await this.increaseSmartPlusBudget(adgroupId, campaignId, advertiserId, accessToken, 0.3);
      } else {
        await this.increaseBudget(adgroupId, advertiserId, accessToken, 0.3);
      }

      return {
        adgroupId,
        action: 'INCREASE_BUDGET',
        reason: `予算増額対象の広告が存在するため、広告セットの予算を30%増額${isSmartPlus ? '（Smart+ API使用）' : ''}`,
      };
    }

    // それ以外は継続
    return {
      adgroupId,
      action: 'CONTINUE',
      reason: '配信継続',
    };
  }

  /**
   * 広告を停止
   */
  private async pauseAd(adId: string, adgroupId: string, advertiserId: string, accessToken: string, reason: string) {
    try {
      this.logger.log(`Pausing ad: ${adId}, reason: ${reason}`);

      // TikTok APIで広告を停止（専用のステータス更新エンドポイントを使用）
      const response = await this.tiktokService.updateAdStatus(advertiserId, accessToken, [adId], 'DISABLE');

      this.logger.log(`Ad pause response: ${JSON.stringify(response)}`);

      // ChangeLogに記録
      await this.logChange('AD', adId, 'PAUSE', 'OPTIMIZATION', null, { status: 'DISABLE' }, reason);

      return { success: true, adId, action: 'PAUSED' };
    } catch (error) {
      this.logger.error(`Failed to pause ad ${adId}:`, error);
      throw new Error(`広告停止に失敗: ${error.message}`);
    }
  }

  /**
   * 広告セットの予算を増額（O-06対応: リトライ機能付き）
   * 上限日予算チェック機能付き
   */
  private async increaseBudget(
    adgroupId: string,
    advertiserId: string,
    accessToken: string,
    increaseRate: number,
  ) {
    try {
      this.logger.log(`Increasing budget for adgroup: ${adgroupId} by ${increaseRate * 100}%`);

      // 広告セット情報を取得
      const adgroup = await this.tiktokService.getAdGroup(advertiserId, accessToken, adgroupId);
      this.logger.log(`AdGroup fetched: budget=${adgroup.budget}, budget_mode=${adgroup.budget_mode}`);

      const currentBudget = adgroup.budget;
      // 小数点以下を切り捨て（TikTok APIは整数のみ受け付けるため）
      let newBudget = Math.floor(currentBudget * (1 + increaseRate));

      // ===== 上限日予算チェック（新機能） =====
      const budgetCapEnabled = this.configService.get('FEATURE_AD_PERFORMANCE_ENABLED') === 'true';
      if (budgetCapEnabled) {
        const budgetCapResult = await this.applyBudgetCapCheck(
          adgroupId,
          adgroup.campaign_id,
          advertiserId,
          currentBudget,
          newBudget,
          adgroup.budget_mode === 'BUDGET_MODE_DAY', // 広告セット予算かどうか
        );

        if (budgetCapResult.skipped) {
          return { success: true, adgroupId, action: 'SKIPPED_DUE_TO_CAP', reason: budgetCapResult.reason };
        }

        if (budgetCapResult.adjustedBudget !== null) {
          newBudget = budgetCapResult.adjustedBudget;
        }
      }

      // 予算が広告セットに設定されている場合
      if (adgroup.budget_mode && adgroup.budget) {
        const response = await this.tiktokService.updateAdGroup(advertiserId, accessToken, adgroupId, {
          budget: newBudget,
        });

        this.logger.log(`AdGroup budget update response: ${JSON.stringify(response)}`);

        // DB操作にリトライを適用（D-01, D-03対応）
        await withDatabaseRetry(
          () => this.logChange(
            'ADGROUP',
            adgroupId,
            'UPDATE_BUDGET',
            'OPTIMIZATION',
            { budget: currentBudget },
            { budget: newBudget },
            `予算を${increaseRate * 100}%増額（${currentBudget} → ${newBudget}）`,
          ),
          { logger: this.logger, context: 'logChange(ADGROUP)' },
        );

        return { success: true, adgroupId, action: 'BUDGET_INCREASED', oldBudget: currentBudget, newBudget };
      } else {
        // 予算がキャンペーンに設定されている場合
        const campaign = await this.tiktokService.getCampaign(advertiserId, accessToken, adgroup.campaign_id);
        this.logger.log(`Campaign fetched: budget=${campaign.budget}`);

        const currentCampaignBudget = campaign.budget;
        // 小数点以下を切り捨て（TikTok APIは整数のみ受け付けるため）
        let newCampaignBudget = Math.floor(currentCampaignBudget * (1 + increaseRate));

        // キャンペーン予算の場合も上限チェック
        if (budgetCapEnabled) {
          const budgetCapResult = await this.applyBudgetCapCheck(
            adgroupId,
            adgroup.campaign_id,
            advertiserId,
            currentCampaignBudget,
            newCampaignBudget,
            false, // キャンペーン予算
          );

          if (budgetCapResult.skipped) {
            return { success: true, campaignId: adgroup.campaign_id, action: 'SKIPPED_DUE_TO_CAP', reason: budgetCapResult.reason };
          }

          if (budgetCapResult.adjustedBudget !== null) {
            newCampaignBudget = budgetCapResult.adjustedBudget;
          }
        }

        const response = await this.tiktokService.updateCampaign(advertiserId, accessToken, adgroup.campaign_id, {
          budget: newCampaignBudget,
        });

        this.logger.log(`Campaign budget update response: ${JSON.stringify(response)}`);

        // DB操作にリトライを適用（D-01, D-03対応）
        await withDatabaseRetry(
          () => this.logChange(
            'CAMPAIGN',
            adgroup.campaign_id,
            'UPDATE_BUDGET',
            'OPTIMIZATION',
            { budget: currentCampaignBudget },
            { budget: newCampaignBudget },
            `予算を${increaseRate * 100}%増額（${currentCampaignBudget} → ${newCampaignBudget}）`,
          ),
          { logger: this.logger, context: 'logChange(CAMPAIGN)' },
        );

        return { success: true, campaignId: adgroup.campaign_id, action: 'BUDGET_INCREASED', oldBudget: currentCampaignBudget, newBudget: newCampaignBudget };
      }
    } catch (error) {
      // O-06: 予算更新API失敗
      const errorInfo = classifyOptimizationError(error, { entityId: adgroupId });
      logOptimizationError(this.logger, errorInfo, 'increaseBudget');
      throw new Error(`予算増額に失敗: ${error.message}`);
    }
  }

  /**
   * 上限日予算チェックを適用
   * @returns skipped: true の場合は増額をスキップ、adjustedBudget: 調整後の予算（上限適用時）
   */
  private async applyBudgetCapCheck(
    adgroupId: string,
    campaignId: string,
    advertiserId: string,
    currentBudget: number,
    proposedNewBudget: number,
    isAdGroupBudget: boolean,
  ): Promise<{
    skipped: boolean;
    adjustedBudget: number | null;
    reason?: string;
  }> {
    try {
      // 広告セット/キャンペーン内の有効な上限日予算を取得
      const budgetCapInfo = isAdGroupBudget
        ? await this.adBudgetCapService.getEffectiveBudgetCapForAdGroup(adgroupId)
        : await this.adBudgetCapService.getEffectiveBudgetCapForCampaign(campaignId);

      // 上限設定がない場合は通常処理
      if (budgetCapInfo.maxBudget === null || budgetCapInfo.limitingAd === null) {
        return { skipped: false, adjustedBudget: null };
      }

      const { maxBudget, limitingAd } = budgetCapInfo;

      // 現在の予算が既に上限以上の場合は増額スキップ
      if (currentBudget >= maxBudget) {
        this.logger.log(
          `Budget cap reached: current budget (${currentBudget}) >= max budget (${maxBudget}). Skipping increase.`,
        );

        // 通知を作成
        await this.notificationService.createBudgetCapReachedNotification(
          advertiserId,
          adgroupId,
          limitingAd.adName,
          currentBudget,
          maxBudget,
        );

        return {
          skipped: true,
          adjustedBudget: null,
          reason: `上限日予算（¥${maxBudget.toLocaleString()}）に到達済み`,
        };
      }

      // 増額後の予算が上限を超える場合は上限に調整
      if (proposedNewBudget > maxBudget) {
        this.logger.log(
          `Budget cap applied: proposed budget (${proposedNewBudget}) > max budget (${maxBudget}). Adjusting to ${maxBudget}.`,
        );

        // 通知を作成
        await this.notificationService.createBudgetCapAppliedNotification(
          advertiserId,
          adgroupId,
          limitingAd.adName,
          limitingAd.maxDailyBudget,
          proposedNewBudget,
          maxBudget,
        );

        return { skipped: false, adjustedBudget: maxBudget };
      }

      // 上限内なのでそのまま
      return { skipped: false, adjustedBudget: null };
    } catch (error) {
      this.logger.error(`Failed to check budget cap: ${error.message}`, error);
      // エラーが発生しても既存処理を止めない
      return { skipped: false, adjustedBudget: null };
    }
  }

  /**
   * 新スマートプラス広告セットの予算を増額
   * CBO有効時はキャンペーン予算を、CBO無効時は広告セット予算を更新
   */
  private async increaseSmartPlusBudget(
    adgroupId: string,
    campaignId: string,
    advertiserId: string,
    accessToken: string,
    increaseRate: number,
  ) {
    try {
      this.logger.log(`Increasing Smart+ budget for adgroup: ${adgroupId}, campaign: ${campaignId} by ${increaseRate * 100}%`);

      // Smart+キャンペーン情報を取得してCBOが有効かどうかを確認
      const campaignsResponse = await this.tiktokService.getCampaigns(advertiserId, accessToken);
      const campaign = campaignsResponse.data?.list?.find((c: any) => c.campaign_id === campaignId);

      if (!campaign) {
        throw new Error(`Smart+ campaign not found: ${campaignId}`);
      }

      this.logger.log(`Smart+ campaign fetched: budget=${campaign.budget}, budget_optimize_on=${campaign.budget_optimize_on}, budget_mode=${campaign.budget_mode}`);

      // CBO有効かどうかを判定
      // budget_optimize_on === true の場合のみCBO有効
      // undefined や false の場合は広告セット予算を使用
      // また、budget_mode が BUDGET_MODE_INFINITE の場合もキャンペーン予算は無制限なので広告セット予算を使用
      const isCBOEnabled = campaign.budget_optimize_on === true && campaign.budget_mode !== 'BUDGET_MODE_INFINITE';

      this.logger.log(`CBO判定: budget_optimize_on=${campaign.budget_optimize_on}, budget_mode=${campaign.budget_mode}, isCBOEnabled=${isCBOEnabled}`);

      if (isCBOEnabled) {
        // CBO有効：キャンペーン予算を更新
        const currentBudget = campaign.budget;
        const newBudget = Math.floor(currentBudget * (1 + increaseRate));

        this.logger.log(`CBO enabled, updating campaign budget: ${currentBudget} → ${newBudget}`);

        const response = await this.tiktokService.updateSmartPlusCampaignBudget(
          advertiserId,
          accessToken,
          campaignId,
          newBudget,
        );

        this.logger.log(`Smart+ campaign budget update response: ${JSON.stringify(response)}`);

        await this.logChange(
          'CAMPAIGN',
          campaignId,
          'UPDATE_BUDGET',
          'OPTIMIZATION',
          { budget: currentBudget },
          { budget: newBudget },
          `Smart+キャンペーン予算を${increaseRate * 100}%増額（${currentBudget} → ${newBudget}）`,
        );

        return { success: true, campaignId, action: 'BUDGET_INCREASED', oldBudget: currentBudget, newBudget, isSmartPlus: true, level: 'CAMPAIGN' };
      } else {
        // CBO無効：広告セット予算を更新
        // 広告セット情報を取得
        const adgroupsResponse = await this.tiktokService.getAdGroups(advertiserId, accessToken, [campaignId]);
        const adgroup = adgroupsResponse.data?.list?.find((ag: any) => ag.adgroup_id === adgroupId);

        if (!adgroup) {
          throw new Error(`Smart+ adgroup not found: ${adgroupId}`);
        }

        const currentBudget = adgroup.budget;
        const newBudget = Math.floor(currentBudget * (1 + increaseRate));

        this.logger.log(`CBO disabled, updating adgroup budget: ${currentBudget} → ${newBudget}`);

        const response = await this.tiktokService.updateSmartPlusAdGroupBudgets(
          advertiserId,
          accessToken,
          [{ adgroup_id: adgroupId, budget: newBudget }],
        );

        this.logger.log(`Smart+ adgroup budget update response: ${JSON.stringify(response)}`);

        await this.logChange(
          'ADGROUP',
          adgroupId,
          'UPDATE_BUDGET',
          'OPTIMIZATION',
          { budget: currentBudget },
          { budget: newBudget },
          `Smart+広告セット予算を${increaseRate * 100}%増額（${currentBudget} → ${newBudget}）`,
        );

        return { success: true, adgroupId, action: 'BUDGET_INCREASED', oldBudget: currentBudget, newBudget, isSmartPlus: true, level: 'ADGROUP' };
      }
    } catch (error) {
      this.logger.error(`Failed to increase Smart+ budget for adgroup ${adgroupId}:`, error);
      throw new Error(`Smart+予算増額に失敗: ${error.message}`);
    }
  }

  /**
   * 変更ログを記録
   */
  private async logChange(
    entityType: string,
    entityId: string,
    action: string,
    source: string,
    beforeData: any,
    afterData: any,
    reason: string,
  ) {
    await this.prisma.changeLog.create({
      data: {
        entityType,
        entityId,
        action,
        source,
        beforeData,
        afterData,
        reason,
      },
    });
  }

  /**
   * アクティブなAdvertiser IDのリストを取得
   */
  private async getActiveAdvertiserIds(): Promise<string[]> {
    const advertisers = await this.prisma.advertiser.findMany({
      where: {
        status: 'ACTIVE',
        appealId: {
          not: null,
        },
      },
      select: {
        tiktokAdvertiserId: true,
      },
    });

    return advertisers.map((a) => a.tiktokAdvertiserId);
  }

  /**
   * 特定キャンペーン配下の広告を取得（通常広告 + 新スマートプラス広告）
   */
  private async getAdsForCampaign(
    advertiserId: string,
    accessToken: string,
    campaignId: string
  ) {
    // 通常の広告を取得
    const adsResponse = await this.tiktokService.getAds(advertiserId, accessToken);
    const regularAds = adsResponse.data?.list || [];

    // 新スマートプラス広告を取得
    const smartPlusAdsResponse = await this.tiktokService.getSmartPlusAds(advertiserId, accessToken);
    const smartPlusAds = smartPlusAdsResponse.data?.list || [];

    // 全広告を結合
    const allAds = [...regularAds, ...smartPlusAds];

    // 指定キャンペーン配下の広告のみフィルタ
    const campaignAds = allAds.filter((ad: any) => ad.campaign_id === campaignId);

    this.logger.debug(`Found ${campaignAds.length} ads for campaign ${campaignId} (Regular: ${regularAds.filter((ad: any) => ad.campaign_id === campaignId).length}, Smart+: ${smartPlusAds.filter((ad: any) => ad.campaign_id === campaignId).length})`);
    return campaignAds;
  }

  /**
   * 配信中のキャンペーンを取得
   */
  private async getActiveCampaigns(advertiserId: string, accessToken: string) {
    const campaignsResponse = await this.tiktokService.getCampaigns(
      advertiserId,
      accessToken
    );

    // ステータスが配信中（ENABLE）のキャンペーンのみフィルタリング
    const activeCampaigns = campaignsResponse.data?.list?.filter(
      (campaign: any) => campaign.operation_status === 'ENABLE'
    ) || [];

    this.logger.log(`Active campaigns count: ${activeCampaigns.length}`);
    return activeCampaigns;
  }

  /**
   * キャンペーンのパフォーマンスを評価（旧スマートプラス対応）
   */
  private async evaluateCampaignPerformance(
    campaign: any,
    appeal: any,
    accessToken: string,
  ): Promise<CampaignPerformance | null> {
    this.logger.log(`Evaluating campaign: ${campaign.campaign_id}, name: ${campaign.campaign_name}`);

    // キャンペーン名をパース
    const parsedName = this.parseAdName(campaign.campaign_name);
    if (!parsedName) {
      this.logger.warn(`Invalid campaign name format, skipping: ${campaign.campaign_name}`);
      return null;
    }

    this.logger.log(`Parsed campaign name successfully: ${JSON.stringify(parsedName)}`);

    // 登録経路を生成
    const registrationPath = this.generateRegistrationPath(parsedName.lpName, appeal.name);

    // 評価期間を計算（過去7日間）
    const { startDate, endDate } = this.calculateEvaluationPeriod();

    // キャンペーンのメトリクスを取得（DBから）
    const metrics = await this.getCampaignMetrics(
      campaign.campaign_id,
      startDate,
      endDate
    );

    // Google SheetsからCV数とフロント販売本数を取得
    const cvCount = await this.googleSheetsService.getCVCount(
      appeal.name,
      appeal.cvSpreadsheetUrl,
      registrationPath,
      startDate,
      endDate,
    );

    const frontSalesCount = await this.googleSheetsService.getFrontSalesCount(
      appeal.name,
      appeal.frontSpreadsheetUrl,
      registrationPath,
      startDate,
      endDate,
    );

    // CPA・フロントCPOを計算
    const cpa = cvCount > 0 ? metrics.spend / cvCount : 0;
    const frontCPO = frontSalesCount > 0 ? metrics.spend / frontSalesCount : 0;

    return {
      campaignId: campaign.campaign_id,
      campaignName: campaign.campaign_name,
      lpName: parsedName.lpName,
      registrationPath,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      spend: metrics.spend,
      cvCount,
      frontSalesCount,
      cpa,
      frontCPO,
    };
  }

  /**
   * キャンペーンのメトリクスを取得
   */
  private async getCampaignMetrics(
    tiktokCampaignId: string,
    startDate: Date,
    endDate: Date
  ) {
    this.logger.debug(`Getting metrics for campaign ${tiktokCampaignId}`);

    // Campaign IDからキャンペーンを検索
    const campaign = await this.prisma.campaign.findUnique({
      where: { tiktokId: tiktokCampaignId },
    });

    if (!campaign) {
      this.logger.warn(`Campaign not found in DB: ${tiktokCampaignId}`);
      return { impressions: 0, clicks: 0, spend: 0 };
    }

    // キャンペーンレベルのメトリクスを取得
    const campaignMetrics = await this.prisma.metric.findMany({
      where: {
        entityType: 'CAMPAIGN',
        campaignId: campaign.id,
        statDate: { gte: startDate, lte: endDate }
      }
    });

    // 広告セットレベルのメトリクスも取得（フォールバック）
    const adgroupMetrics = await this.prisma.metric.findMany({
      where: {
        entityType: 'ADGROUP',
        adGroup: { campaignId: campaign.id },
        statDate: { gte: startDate, lte: endDate }
      }
    });

    // キャンペーンメトリクスを優先、なければ広告セットメトリクスを使用
    const metrics = campaignMetrics.length > 0 ? campaignMetrics : adgroupMetrics;

    this.logger.log(`Found ${metrics.length} metrics for campaign ${tiktokCampaignId} (using ${campaignMetrics.length > 0 ? 'CAMPAIGN' : 'ADGROUP'} level)`);

    // 合計を計算
    return {
      impressions: metrics.reduce((sum, m) => sum + m.impressions, 0),
      clicks: metrics.reduce((sum, m) => sum + m.clicks, 0),
      spend: metrics.reduce((sum, m) => sum + m.spend, 0),
    };
  }

  /**
   * キャンペーンを停止
   */
  private async pauseCampaign(
    campaignId: string,
    advertiserId: string,
    accessToken: string,
    reason: string,
  ) {
    await this.tiktokService.updateCampaign(
      advertiserId,
      accessToken,
      campaignId,
      { status: 'DISABLE' }
    );

    // ChangeLogに記録
    await this.logChange(
      'CAMPAIGN',
      campaignId,
      'PAUSE',
      'OPTIMIZATION',
      { status: 'ENABLE' },
      { status: 'DISABLE' },
      reason,
    );

    this.logger.log(`Paused campaign ${campaignId}: ${reason}`);
  }

  /**
   * キャンペーンの最適化判定を作成
   */
  private async makeCampaignOptimizationDecision(
    performance: CampaignPerformance,
    appeal: any,
  ): Promise<CampaignOptimizationDecision> {
    const { impressions, spend, cvCount, frontSalesCount, cpa, frontCPO } = performance;
    const { allowableCPA, targetCPA, allowableFrontCPO, targetFrontCPO } = appeal;

    // ヘルパー関数：decisionを作成
    const createDecision = (
      action: 'PAUSE' | 'CONTINUE' | 'INCREASE_BUDGET',
      reason: string
    ): CampaignOptimizationDecision => ({
      campaignId: performance.campaignId,
      campaignName: performance.campaignName,
      action,
      reason,
      performance,
    });

    // 5000インプレッション未達の場合
    if (impressions < 5000) {
      return createDecision('CONTINUE', `インプレッション数が5000未満（${impressions}）のため、継続配信`);
    }

    // フロント販売が1件以上ある場合
    if (frontSalesCount >= 1) {
      if (frontCPO <= targetFrontCPO) {
        return createDecision('INCREASE_BUDGET', `フロントCPO（¥${frontCPO.toFixed(0)}）が目標値（¥${targetFrontCPO}）以下のため、予算30%増額`);
      } else if (frontCPO <= allowableFrontCPO) {
        return createDecision('CONTINUE', `フロントCPO（¥${frontCPO.toFixed(0)}）が許容値（¥${allowableFrontCPO}）以下のため、継続配信`);
      } else {
        return createDecision('PAUSE', `フロントCPO（¥${frontCPO.toFixed(0)}）が許容値（¥${allowableFrontCPO}）を超過したため停止`);
      }
    }

    // フロント販売が0件の場合
    if (frontSalesCount === 0) {
      if (cpa === 0) {
        return createDecision('PAUSE', `CVもフロント販売も0件のため停止（広告費: ¥${spend.toFixed(0)}）`);
      }

      // CVはあるがフロント販売が0件の場合
      const totalSpend = spend; // キャンペーンレベルでは累積広告費を使用
      if (cpa <= allowableCPA && totalSpend <= allowableFrontCPO) {
        return createDecision('CONTINUE', `CPA（¥${cpa.toFixed(0)}）が許容値以下で累積広告費も範囲内のため継続配信`);
      } else {
        return createDecision('PAUSE', `CPA（¥${cpa.toFixed(0)}）または累積広告費（¥${totalSpend.toFixed(0)}）が基準を超過したため停止`);
      }
    }

    // デフォルト: 継続配信
    return createDecision('CONTINUE', '継続配信');
  }

  /**
   * デバッグ用：評価期間を確認
   */
  async debugEvaluationPeriod() {
    const { startDate, endDate } = this.calculateEvaluationPeriod();

    return {
      today: new Date().toISOString(),
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      startDateFormatted: `${startDate.getFullYear()}/${String(startDate.getMonth() + 1).padStart(2, '0')}/${String(startDate.getDate()).padStart(2, '0')}`,
      endDateFormatted: `${endDate.getFullYear()}/${String(endDate.getMonth() + 1).padStart(2, '0')}/${String(endDate.getDate()).padStart(2, '0')}`,
      periodDescription: `${startDate.getMonth() + 1}/${startDate.getDate()} ～ ${endDate.getMonth() + 1}/${endDate.getDate()}`,
    };
  }
}
