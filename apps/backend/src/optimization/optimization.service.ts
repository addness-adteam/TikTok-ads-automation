import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TiktokService } from '../tiktok/tiktok.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { AppealService } from '../appeal/appeal.service';

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
}

interface OptimizationDecision {
  adId: string;
  adName: string;
  adgroupId: string;
  action: 'PAUSE' | 'CONTINUE' | 'INCREASE_BUDGET';
  reason: string;
  currentBudget?: number;
  newBudget?: number;
  performance?: AdPerformance; // 追加：パフォーマンス情報
}

@Injectable()
export class OptimizationService {
  private readonly logger = new Logger(OptimizationService.name);

  constructor(
    private prisma: PrismaService,
    private tiktokService: TiktokService,
    private googleSheetsService: GoogleSheetsService,
    private appealService: AppealService,
  ) {}

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
      throw new Error(`Advertiser ${advertiserId} not found`);
    }

    if (!advertiser.appeal) {
      throw new Error(`No appeal assigned to advertiser ${advertiserId}`);
    }

    const appeal = advertiser.appeal;

    // 配信中の広告を取得
    const activeAds = await this.getActiveAds(advertiserId, accessToken);
    this.logger.log(`Found ${activeAds.length} active ads for advertiser ${advertiserId}`);

    // 各広告のパフォーマンスを評価
    const adPerformances: AdPerformance[] = [];
    for (const ad of activeAds) {
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

    return {
      advertiserId,
      success: true,
      totalAds: activeAds.length,
      evaluated: adPerformances.length,
      decisions: decisions.length,
      executed: executionResults.length,
      results: executionResults,
      detailedLogs, // 追加：各広告の詳細ログ
    };
  }

  /**
   * 配信中の広告を取得
   */
  private async getActiveAds(advertiserId: string, accessToken: string) {
    // TikTok APIから広告一覧を取得
    const adsResponse = await this.tiktokService.getAds(advertiserId, accessToken);

    // ステータスが配信中（ENABLE）の広告のみフィルタリング
    const activeAds = adsResponse.data?.list?.filter((ad: any) => ad.operation_status === 'ENABLE') || [];

    this.logger.log(`Active ads count: ${activeAds.length}`);
    if (activeAds.length > 0) {
      this.logger.log(`Sample ad names: ${activeAds.slice(0, 3).map((ad: any) => ad.ad_name).join(', ')}`);
    }

    return activeAds;
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
    };
  }

  /**
   * 広告名をパース
   * 形式: 出稿日/制作者名/CR名/LP名-番号
   * CR名は複数パートに分かれることがある（例: 問題ないです/ひったくりVer_リール投稿）
   */
  private parseAdName(adName: string): { date: string; creator: string; creativeName: string; lpName: string } | null {
    const parts = adName.split('/');

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
   * 形式: TikTok広告-訴求-LP名および番号
   */
  private generateRegistrationPath(lpName: string, appealName: string): string {
    return `TikTok広告-${appealName}-${lpName}`;
  }

  /**
   * 評価期間を計算（過去7日間、当日は含めない）
   */
  private calculateEvaluationPeriod(): { startDate: Date; endDate: Date } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - 1); // 昨日
    endDate.setHours(23, 59, 59, 999); // その日の終わりまで含める

    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6); // 7日前
    startDate.setHours(0, 0, 0, 0); // その日の始まりから

    return { startDate, endDate };
  }

  /**
   * 広告のメトリクスを取得（過去7日間）
   * @param tiktokAdId TikTok APIから返される広告ID
   */
  private async getAdMetrics(tiktokAdId: string, startDate: Date, endDate: Date) {
    // まずTikTok IDからAdレコードを検索
    const ad = await this.prisma.ad.findUnique({
      where: { tiktokId: tiktokAdId },
    });

    if (!ad) {
      this.logger.warn(`Ad not found in DB for tiktokId: ${tiktokAdId}`);
      return {
        impressions: 0,
        clicks: 0,
        spend: 0,
      };
    }

    // Adレコードのid（UUID）を使ってメトリクスを検索
    const metrics = await this.prisma.metric.findMany({
      where: {
        adId: ad.id,
        statDate: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    this.logger.log(`Found ${metrics.length} metrics for ad ${tiktokAdId} (${ad.id})`);

    // 合計を計算
    const totalImpressions = metrics.reduce((sum, m) => sum + m.impressions, 0);
    const totalClicks = metrics.reduce((sum, m) => sum + (m.clicks || 0), 0);
    const totalSpend = metrics.reduce((sum, m) => sum + m.spend, 0);

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
      action,
      reason,
      currentBudget,
      newBudget,
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
    const hasIncreaseBudget = remainingDecisions.some((d) => d.action === 'INCREASE_BUDGET');

    if (hasIncreaseBudget) {
      await this.increaseBudget(adgroupId, advertiserId, accessToken, 0.3); // 30%増額
      return {
        adgroupId,
        action: 'INCREASE_BUDGET',
        reason: '予算増額対象の広告が存在するため、広告セットの予算を30%増額',
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

      // TikTok APIで広告を停止
      const response = await this.tiktokService.updateAd(advertiserId, accessToken, adId, adgroupId, { status: 'DISABLE' });

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
   * 広告セットの予算を増額
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
      const newBudget = Math.floor(currentBudget * (1 + increaseRate));

      // 予算が広告セットに設定されている場合
      if (adgroup.budget_mode && adgroup.budget) {
        const response = await this.tiktokService.updateAdGroup(advertiserId, accessToken, adgroupId, {
          budget: newBudget,
        });

        this.logger.log(`AdGroup budget update response: ${JSON.stringify(response)}`);

        await this.logChange(
          'ADGROUP',
          adgroupId,
          'UPDATE_BUDGET',
          'OPTIMIZATION',
          { budget: currentBudget },
          { budget: newBudget },
          `予算を${increaseRate * 100}%増額（${currentBudget} → ${newBudget}）`,
        );

        return { success: true, adgroupId, action: 'BUDGET_INCREASED', oldBudget: currentBudget, newBudget };
      } else {
        // 予算がキャンペーンに設定されている場合
        const campaign = await this.tiktokService.getCampaign(advertiserId, accessToken, adgroup.campaign_id);
        this.logger.log(`Campaign fetched: budget=${campaign.budget}`);

        const currentCampaignBudget = campaign.budget;
        // 小数点以下を切り捨て（TikTok APIは整数のみ受け付けるため）
        const newCampaignBudget = Math.floor(currentCampaignBudget * (1 + increaseRate));

        const response = await this.tiktokService.updateCampaign(advertiserId, accessToken, adgroup.campaign_id, {
          budget: newCampaignBudget,
        });

        this.logger.log(`Campaign budget update response: ${JSON.stringify(response)}`);

        await this.logChange(
          'CAMPAIGN',
          adgroup.campaign_id,
          'UPDATE_BUDGET',
          'OPTIMIZATION',
          { budget: currentCampaignBudget },
          { budget: newCampaignBudget },
          `予算を${increaseRate * 100}%増額（${currentCampaignBudget} → ${newCampaignBudget}）`,
        );

        return { success: true, campaignId: adgroup.campaign_id, action: 'BUDGET_INCREASED', oldBudget: currentCampaignBudget, newBudget: newCampaignBudget };
      }
    } catch (error) {
      this.logger.error(`Failed to increase budget for adgroup ${adgroupId}:`, error);
      throw new Error(`予算増額に失敗: ${error.message}`);
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
