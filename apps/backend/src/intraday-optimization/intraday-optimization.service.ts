import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TiktokService } from '../tiktok/tiktok.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { AppealService } from '../appeal/appeal.service';
import {
  NotificationService,
  NotificationSeverity,
  EntityType,
} from '../notification/notification.service';
import {
  batchJobLock,
  validateAdNameFormat,
  withDatabaseRetry,
} from '../common/utils';

/**
 * 日中CPA最適化判定結果
 */
type IntradayDecision = 'PAUSE' | 'REDUCE_BUDGET' | 'CONTINUE';

export interface IntradayCheckResult {
  adId: string;
  adName: string;
  adgroupId: string;
  campaignId: string;
  decision: IntradayDecision;
  reason: string;
  todaySpend: number;
  todayCPA: number | null;
  yesterdayCPA: number | null;
  todayCV: number;
  yesterdayCV: number;
}

export interface DryRunResult {
  dryRun: boolean;
  advertisers: {
    advertiserId: string;
    ads: IntradayCheckResult[];
  }[];
  summary: {
    totalAds: number;
    wouldPause: number;
    wouldReduce: number;
    wouldContinue: number;
  };
}

@Injectable()
export class IntradayOptimizationService {
  private readonly logger = new Logger(IntradayOptimizationService.name);

  // 予算削減率（デフォルト50%）
  private readonly BUDGET_REDUCTION_RATE = 0.5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tiktokService: TiktokService,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly appealService: AppealService,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 15:00 日中CPAチェックジョブ
   */
  @Cron('0 15 * * *', {
    name: 'intraday-cpa-check',
    timeZone: 'Asia/Tokyo',
  })
  async runIntradayCPACheck() {
    // フィーチャーフラグチェック
    if (this.configService.get('FEATURE_INTRADAY_CPA_CHECK_ENABLED') !== 'true') {
      this.logger.log('Intraday CPA check is disabled');
      return;
    }

    const jobName = 'intraday-cpa-check';

    // ロック取得
    if (!batchJobLock.acquire(jobName, 1800000)) {
      this.logger.warn(`[IC-01] Previous intraday CPA check is still running. Skipping...`);
      return;
    }

    this.logger.log('Starting intraday CPA check job');

    try {
      await this.executeIntradayCPACheck();
    } catch (error) {
      this.logger.error('Intraday CPA check failed:', error);
    } finally {
      batchJobLock.release(jobName);
      this.logger.log('Intraday CPA check job completed');
    }
  }

  /**
   * 23:59 配信再開ジョブ
   */
  @Cron('59 23 * * *', {
    name: 'intraday-resume',
    timeZone: 'Asia/Tokyo',
  })
  async runIntradayResume() {
    // フィーチャーフラグチェック
    if (this.configService.get('FEATURE_INTRADAY_CPA_CHECK_ENABLED') !== 'true') {
      this.logger.log('Intraday resume is disabled');
      return;
    }

    const jobName = 'intraday-resume';

    if (!batchJobLock.acquire(jobName, 600000)) {
      this.logger.warn(`[IR-01] Previous intraday resume is still running. Skipping...`);
      return;
    }

    this.logger.log('Starting intraday resume job');

    try {
      await this.executeIntradayResume();
    } catch (error) {
      this.logger.error('Intraday resume failed:', error);
    } finally {
      batchJobLock.release(jobName);
      this.logger.log('Intraday resume job completed');
    }
  }

  /**
   * 23:59:30 予算復元ジョブ
   */
  @Cron('30 59 23 * * *', {
    name: 'intraday-budget-restore',
    timeZone: 'Asia/Tokyo',
  })
  async runIntradayBudgetRestore() {
    // フィーチャーフラグチェック
    if (this.configService.get('FEATURE_INTRADAY_CPA_CHECK_ENABLED') !== 'true') {
      this.logger.log('Intraday budget restore is disabled');
      return;
    }

    const jobName = 'intraday-budget-restore';

    if (!batchJobLock.acquire(jobName, 600000)) {
      this.logger.warn(`[IB-01] Previous intraday budget restore is still running. Skipping...`);
      return;
    }

    this.logger.log('Starting intraday budget restore job');

    try {
      await this.executeIntradayBudgetRestore();
    } catch (error) {
      this.logger.error('Intraday budget restore failed:', error);
    } finally {
      batchJobLock.release(jobName);
      this.logger.log('Intraday budget restore job completed');
    }
  }

  /**
   * 日中CPAチェックの実行
   * @param dryRun trueの場合、実際のAPI呼び出しをスキップして判定結果のみ返す
   */
  async executeIntradayCPACheck(dryRun = false): Promise<DryRunResult | void> {
    if (dryRun) {
      this.logger.log('=== DRY RUN MODE: No actual changes will be made ===');
    }

    // 除外Advertiser設定を取得
    const excludedAdvertisers = this.getExcludedAdvertisers();

    // 有効なOAuthTokenを持つAdvertiserを取得
    const oauthTokens = await this.prisma.oAuthToken.findMany({
      where: {
        expiresAt: { gt: new Date() },
        NOT: { advertiserId: { in: excludedAdvertisers } },
      },
    });

    if (oauthTokens.length === 0) {
      this.logger.warn('No active advertisers found for intraday check');
      if (dryRun) {
        return {
          dryRun: true,
          advertisers: [],
          summary: { totalAds: 0, wouldPause: 0, wouldReduce: 0, wouldContinue: 0 },
        };
      }
      return;
    }

    let totalPaused = 0;
    let totalReduced = 0;
    let totalContinued = 0;
    const dryRunResults: DryRunResult['advertisers'] = [];

    for (const token of oauthTokens) {
      try {
        const result = await this.checkAdvertiser(token.advertiserId, token.accessToken, dryRun);
        totalPaused += result.paused;
        totalReduced += result.reduced;
        totalContinued += result.continued;

        if (dryRun && result.checkResults) {
          dryRunResults.push({
            advertiserId: token.advertiserId,
            ads: result.checkResults,
          });
        }
      } catch (error) {
        this.logger.error(`[IC-01] Failed to check advertiser ${token.advertiserId}: ${error.message}`);
      }
    }

    this.logger.log(`Intraday CPA check completed. Paused: ${totalPaused}, Reduced: ${totalReduced}, Continued: ${totalContinued}`);

    if (dryRun) {
      return {
        dryRun: true,
        advertisers: dryRunResults,
        summary: {
          totalAds: totalPaused + totalReduced + totalContinued,
          wouldPause: totalPaused,
          wouldReduce: totalReduced,
          wouldContinue: totalContinued,
        },
      };
    }
  }

  /**
   * 個別Advertiserのチェック
   */
  private async checkAdvertiser(
    advertiserId: string,
    accessToken: string,
    dryRun = false,
  ): Promise<{ paused: number; reduced: number; continued: number; checkResults?: IntradayCheckResult[]; debug?: any }> {
    this.logger.log(`Checking advertiser: ${advertiserId}${dryRun ? ' (DRY RUN)' : ''}`);

    // Advertiser情報とAppeal設定を取得
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: advertiserId },
      include: { appeal: true },
    });

    if (!advertiser || !advertiser.appeal) {
      this.logger.warn(`No appeal settings for advertiser ${advertiserId}`);
      return { paused: 0, reduced: 0, continued: 0, checkResults: [] };
    }

    const { targetCPA, allowableCPA } = advertiser.appeal;

    if (!targetCPA || !allowableCPA) {
      this.logger.warn(`CPA settings incomplete for advertiser ${advertiserId}`);
      return { paused: 0, reduced: 0, continued: 0, checkResults: [] };
    }

    // 配信中の広告を取得
    const activeAds = await this.getActiveAds(advertiserId, accessToken);

    if (activeAds.length === 0) {
      this.logger.log(`No active ads for advertiser ${advertiserId}`);
      return { paused: 0, reduced: 0, continued: 0, checkResults: [] };
    }

    // 当日・前日のメトリクスを取得
    const today = this.getTodayJST();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const todayStr = this.formatDateStr(today);

    // 当日メトリクス取得（TikTok API）
    const todayMetrics = await this.getTodayMetrics(advertiserId, accessToken, todayStr);

    // CV数取得（Google Sheets）
    const cvData = await this.getCVDataForAds(advertiser.appeal, activeAds, today, yesterday);

    let paused = 0;
    let reduced = 0;
    let continued = 0;
    const checkResults: IntradayCheckResult[] = [];

    // 各広告を評価
    for (const ad of activeAds) {
      try {
        const result = await this.evaluateAd(
          ad,
          advertiser,
          todayMetrics,
          cvData,
          targetCPA,
          allowableCPA,
          accessToken,
        );

        checkResults.push(result);

        if (result.decision === 'PAUSE') {
          if (!dryRun) {
            await this.pauseAd(result, advertiserId, accessToken, today);
          } else {
            this.logger.log(`[DRY RUN] Would PAUSE ad ${result.adId}: ${result.reason}`);
          }
          paused++;
        } else if (result.decision === 'REDUCE_BUDGET') {
          if (!dryRun) {
            await this.reduceBudget(result, advertiserId, accessToken, today);
          } else {
            this.logger.log(`[DRY RUN] Would REDUCE_BUDGET for ad ${result.adId}: ${result.reason}`);
          }
          reduced++;
        } else {
          if (dryRun) {
            this.logger.log(`[DRY RUN] Would CONTINUE ad ${result.adId}: ${result.reason}`);
          }
          continued++;
        }

        this.logger.log(
          `Ad ${ad.ad_id} (${ad.ad_name}): ${result.decision} - ${result.reason}`,
        );
      } catch (error) {
        this.logger.error(`Failed to evaluate ad ${ad.ad_id}: ${error.message}`);
      }
    }

    return { paused, reduced, continued, checkResults };
  }

  /**
   * クリエイティブ名（旧スマプラ等）かどうかを判定
   * 拡張子（.mp4, .jpg等）を含む広告名はクリエイティブ名とみなす
   */
  private isCreativeName(adName: string | null | undefined): boolean {
    if (!adName) return false;

    const videoExtensions = ['.mp4', '.MP4', '.mov', '.MOV', '.avi', '.AVI'];
    const imageExtensions = ['.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.gif', '.GIF'];
    const allExtensions = [...videoExtensions, ...imageExtensions];

    return allExtensions.some(ext => adName.includes(ext));
  }

  /**
   * 配信中広告を取得
   * 通常広告とSmart+広告を取得し、Smart+広告は正しい広告名を持つAPIから取得
   * クリエイティブ名（旧スマプラ等）の広告は除外
   */
  private async getActiveAds(advertiserId: string, accessToken: string): Promise<any[]> {
    try {
      // 1. Smart+広告を先に取得（/smart_plus/ad/get/ からは正しいad_nameが返される）
      const smartPlusResponse = await this.tiktokService.getSmartPlusAds(advertiserId, accessToken);
      const smartPlusAds = smartPlusResponse.data?.list?.filter((ad: any) => ad.operation_status === 'ENABLE') || [];

      // 2. Smart+広告のIDセットを作成
      const smartPlusAdIds = new Set(smartPlusAds.map((ad: any) => ad.smart_plus_ad_id));

      // 3. 通常広告を取得
      const adsResponse = await this.tiktokService.getAds(advertiserId, accessToken);
      const allRegularAds = adsResponse.data?.list?.filter((ad: any) => ad.operation_status === 'ENABLE') || [];

      // 4. 通常広告からSmart+広告を除外
      // 通常の/ad/get/でもSmart+広告が返ってくるが、広告名がクリエイティブ名になっているため除外
      const regularAdsOnly = allRegularAds.filter((ad: any) => {
        return !smartPlusAdIds.has(ad.ad_id) && !smartPlusAdIds.has(ad.smart_plus_ad_id);
      });

      // 5. Smart+広告にフラグを付与
      // /smart_plus/ad/get/ からの ad_name は正しい手動設定名なので、そのまま使う
      const taggedSmartPlusAds = smartPlusAds.map((ad: any) => ({
        ...ad,
        ad_id: ad.smart_plus_ad_id || ad.ad_id,
        isSmartPlus: true,
      }));

      // 6. 全広告を結合
      const allActiveAds = [...regularAdsOnly, ...taggedSmartPlusAds];

      // 7. 正しい広告名フォーマット（日付/制作者/CR名/LP名）の広告のみを対象にする
      // クリエイティブ名やフォーマット不正の広告（旧スマプラ等）は除外
      const targetAds = allActiveAds.filter((ad: any) => {
        // クリエイティブ名は除外
        if (this.isCreativeName(ad.ad_name)) return false;
        // 正しいフォーマットのみ対象
        const validation = validateAdNameFormat(ad.ad_name);
        return validation.isValid;
      });
      const excludedCount = allActiveAds.length - targetAds.length;

      this.logger.log(`Active ads: ${targetAds.length} (Total: ${allActiveAds.length}, Excluded: ${excludedCount})`);

      return targetAds;
    } catch (error) {
      this.logger.error(`Failed to get active ads: ${error.message}`);
      return [];
    }
  }

  /**
   * 当日メトリクス取得（TikTok API）
   * 通常広告とSmart+広告の両方のメトリクスを取得してマージ
   */
  private async getTodayMetrics(
    advertiserId: string,
    accessToken: string,
    todayStr: string,
  ): Promise<Map<string, { spend: number; impressions: number; clicks: number }>> {
    const metricsMap = new Map<string, { spend: number; impressions: number; clicks: number }>();

    // 1. 通常広告のメトリクス取得（AUCTION_AD）
    try {
      const reportData = await this.tiktokService.getAllReportData(
        advertiserId,
        accessToken,
        {
          dataLevel: 'AUCTION_AD',
          startDate: todayStr,
          endDate: todayStr,
        },
      );

      for (const row of reportData) {
        const adId = row.dimensions?.ad_id;
        if (adId) {
          metricsMap.set(adId, {
            spend: parseFloat(row.metrics?.spend || '0'),
            impressions: parseInt(row.metrics?.impressions || '0', 10),
            clicks: parseInt(row.metrics?.clicks || '0', 10),
          });
        }
      }
      this.logger.debug(`Regular ad metrics: ${metricsMap.size} ads`);
    } catch (error) {
      this.logger.error(`Failed to get regular ad metrics: ${error.message}`);
    }

    // 2. Smart+広告のメトリクス取得（/smart_plus/material_report/overview/）
    try {
      const smartPlusMetrics = await this.tiktokService.getSmartPlusAdMetrics(
        advertiserId,
        accessToken,
        {
          startDate: todayStr,
          endDate: todayStr,
        },
      );

      // Smart+メトリクスはsmart_plus_ad_idごとに集計
      const smartPlusData = smartPlusMetrics.data?.list || [];
      const smartPlusAggregated = new Map<string, { spend: number; impressions: number; clicks: number }>();

      for (const row of smartPlusData) {
        const smartPlusAdId = row.dimensions?.smart_plus_ad_id;
        if (!smartPlusAdId) continue;

        const spend = parseFloat(row.metrics?.spend || '0');
        const impressions = parseInt(row.metrics?.impressions || '0', 10);
        const clicks = parseInt(row.metrics?.clicks || '0', 10);

        const existing = smartPlusAggregated.get(smartPlusAdId);
        if (existing) {
          // 同じsmart_plus_ad_idの複数レコード（クリエイティブ別）を集計
          existing.spend += spend;
          existing.impressions += impressions;
          existing.clicks += clicks;
        } else {
          smartPlusAggregated.set(smartPlusAdId, { spend, impressions, clicks });
        }
      }

      // Smart+メトリクスをメインのマップにマージ
      for (const [adId, metrics] of smartPlusAggregated) {
        metricsMap.set(adId, metrics);
      }

      this.logger.debug(`Smart+ ad metrics: ${smartPlusAggregated.size} ads`);
    } catch (error) {
      this.logger.error(`Failed to get Smart+ ad metrics: ${error.message}`);
    }

    this.logger.log(`Total metrics loaded: ${metricsMap.size} ads`);

    return metricsMap;
  }

  /**
   * Google SheetsからCV数を取得
   * 登録経路ごとに当日・前日のCV数を取得
   */
  private async getCVDataForAds(
    appeal: any,
    ads: any[],
    today: Date,
    yesterday: Date,
  ): Promise<Map<string, { todayCV: number; yesterdayCV: number }>> {
    const cvData = new Map<string, { todayCV: number; yesterdayCV: number }>();

    if (!appeal.cvSpreadsheetUrl) {
      this.logger.warn('No CV spreadsheet URL configured');
      return cvData;
    }

    // 当日と前日の日付範囲を設定
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);

    const yesterdayStart = new Date(yesterday);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(23, 59, 59, 999);

    // 各広告の登録経路に対してCV数を取得
    const processedPaths = new Set<string>();

    for (const ad of ads) {
      const nameValidation = validateAdNameFormat(ad.ad_name);
      if (!nameValidation.isValid || !nameValidation.parsed?.lpName) continue;

      const lpName = nameValidation.parsed.lpName;

      // 登録経路を構築（例: TikTok広告-SNS-LP-A）
      const registrationPath = `TikTok広告-${appeal.name}-${lpName}`;

      // 既に処理済みならスキップ
      if (processedPaths.has(registrationPath)) continue;
      processedPaths.add(registrationPath);

      try {
        // 当日CV数
        const todayCV = await this.googleSheetsService.getCVCount(
          appeal.name,
          appeal.cvSpreadsheetUrl,
          registrationPath,
          todayStart,
          todayEnd,
        );

        // 前日CV数
        const yesterdayCV = await this.googleSheetsService.getCVCount(
          appeal.name,
          appeal.cvSpreadsheetUrl,
          registrationPath,
          yesterdayStart,
          yesterdayEnd,
        );

        cvData.set(lpName, { todayCV, yesterdayCV });

        this.logger.debug(
          `CV data for ${lpName}: today=${todayCV}, yesterday=${yesterdayCV}`,
        );
      } catch (error) {
        this.logger.warn(`Failed to get CV for ${registrationPath}: ${error.message}`);
        cvData.set(lpName, { todayCV: 0, yesterdayCV: 0 });
      }
    }

    return cvData;
  }

  /**
   * 広告を評価して判定
   */
  private async evaluateAd(
    ad: any,
    advertiser: any,
    todayMetrics: Map<string, { spend: number; impressions: number; clicks: number }>,
    cvData: Map<string, { todayCV: number; yesterdayCV: number }>,
    targetCPA: number,
    allowableCPA: number,
    accessToken: string,
  ): Promise<IntradayCheckResult> {
    const adId = ad.ad_id || ad.smart_plus_ad_id;
    const adName = ad.ad_name;
    const adgroupId = ad.adgroup_id;
    const campaignId = ad.campaign_id;

    // 広告名フォーマット検証
    const nameValidation = validateAdNameFormat(adName);
    if (!nameValidation.isValid) {
      return {
        adId,
        adName,
        adgroupId,
        campaignId,
        decision: 'CONTINUE',
        reason: '広告名フォーマット不正のためスキップ',
        todaySpend: 0,
        todayCPA: null,
        yesterdayCPA: null,
        todayCV: 0,
        yesterdayCV: 0,
      };
    }

    // メトリクス取得
    const metrics = todayMetrics.get(adId) || { spend: 0, impressions: 0, clicks: 0 };
    const todaySpend = metrics.spend;

    // LP名からCV数を取得
    const lpName = nameValidation.parsed?.lpName || '';
    const cv = cvData.get(lpName) || { todayCV: 0, yesterdayCV: 0 };
    const todayCV = cv.todayCV;
    const yesterdayCV = cv.yesterdayCV;

    // CPA計算
    const todayCPA = todayCV > 0 ? todaySpend / todayCV : null;
    const yesterdayCPA = yesterdayCV > 0 ? await this.getYesterdaySpend(adId, advertiser.id) / yesterdayCV : null;

    // 判定ロジック
    let decision: IntradayDecision;
    let reason: string;

    if (todayCV === 0) {
      // CV未発生時の判定
      if (yesterdayCPA === null || yesterdayCPA === 0) {
        // 前日もCV=0 → 継続
        decision = 'CONTINUE';
        reason = '当日CV=0、前日もCV=0のため継続（元々CVが少ない広告）';
      } else {
        // 前日はCVあり → 停止
        decision = 'PAUSE';
        reason = `当日CV=0、前日CPA=¥${yesterdayCPA.toFixed(0)} → CVR悪化の兆候のため停止`;
      }
    } else if (todayCPA !== null) {
      if (todayCPA <= targetCPA) {
        decision = 'CONTINUE';
        reason = `当日CPA=¥${todayCPA.toFixed(0)} ≤ 目標CPA=¥${targetCPA} のため継続`;
      } else if (todayCPA <= allowableCPA) {
        decision = 'REDUCE_BUDGET';
        reason = `当日CPA=¥${todayCPA.toFixed(0)} > 目標CPA=¥${targetCPA}、≤ 許容CPA=¥${allowableCPA} のため予算50%削減`;
      } else {
        decision = 'PAUSE';
        reason = `当日CPA=¥${todayCPA.toFixed(0)} > 許容CPA=¥${allowableCPA} のため停止`;
      }
    } else {
      decision = 'CONTINUE';
      reason = '判定データ不足のため継続';
    }

    return {
      adId,
      adName,
      adgroupId,
      campaignId,
      decision,
      reason,
      todaySpend,
      todayCPA,
      yesterdayCPA,
      todayCV,
      yesterdayCV,
    };
  }

  /**
   * 前日の消化額を取得
   */
  private async getYesterdaySpend(adId: string, advertiserId: string): Promise<number> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const nextDay = new Date(yesterday);
    nextDay.setDate(nextDay.getDate() + 1);

    const ad = await this.prisma.ad.findUnique({
      where: { tiktokId: adId },
    });

    if (!ad) return 0;

    const metrics = await this.prisma.metric.findMany({
      where: {
        adId: ad.id,
        statDate: {
          gte: yesterday,
          lt: nextDay,
        },
      },
    });

    return metrics.reduce((sum, m) => sum + m.spend, 0);
  }

  /**
   * 広告を停止
   */
  private async pauseAd(
    result: IntradayCheckResult,
    advertiserId: string,
    accessToken: string,
    today: Date,
  ) {
    try {
      // TikTok APIで広告を停止
      await this.tiktokService.updateAdStatus(advertiserId, accessToken, [result.adId], 'DISABLE');

      // IntradayPauseLogに記録
      await withDatabaseRetry(
        () =>
          this.prisma.intradayPauseLog.create({
            data: {
              adId: result.adId,
              advertiserId,
              pauseDate: today,
              pauseTime: new Date(),
              pauseReason: result.todayCPA === null ? 'NO_CV_WITH_PREVIOUS_CV' : 'CPA_EXCEEDED',
              todaySpend: result.todaySpend,
              todayCPA: result.todayCPA,
              yesterdayCPA: result.yesterdayCPA,
              targetCPA: 0, // 後で取得
              allowableCPA: 0, // 後で取得
            },
          }),
        { logger: this.logger, context: 'IntradayPauseLog create' },
      );

      // ChangeLogに記録
      await this.logChange('AD', result.adId, 'INTRADAY_PAUSE', 'INTRADAY_OPTIMIZATION', null, { status: 'DISABLE' }, result.reason);

      // 通知作成
      await this.createPauseNotification(result, advertiserId);

      this.logger.log(`Paused ad ${result.adId}: ${result.reason}`);
    } catch (error) {
      this.logger.error(`[IC-03] Failed to pause ad ${result.adId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * 予算を50%削減
   */
  private async reduceBudget(
    result: IntradayCheckResult,
    advertiserId: string,
    accessToken: string,
    today: Date,
  ) {
    try {
      // 広告セット情報を取得
      const adgroup = await this.tiktokService.getAdGroup(advertiserId, accessToken, result.adgroupId);
      const isCBO = !(adgroup.budget_mode && adgroup.budget && adgroup.budget > 0);

      let originalBudget: number;
      let reducedBudget: number;
      let entityId: string;

      if (isCBO) {
        // キャンペーン予算の場合
        const campaign = await this.tiktokService.getCampaign(advertiserId, accessToken, result.campaignId);
        originalBudget = campaign.budget;
        reducedBudget = Math.floor(originalBudget * this.BUDGET_REDUCTION_RATE);
        entityId = result.campaignId;

        await this.tiktokService.updateCampaign(advertiserId, accessToken, result.campaignId, {
          budget: reducedBudget,
        });
      } else {
        // 広告セット予算の場合
        originalBudget = adgroup.budget;
        reducedBudget = Math.floor(originalBudget * this.BUDGET_REDUCTION_RATE);
        entityId = result.adgroupId;

        await this.tiktokService.updateAdGroup(advertiserId, accessToken, result.adgroupId, {
          budget: reducedBudget,
        });
      }

      // IntradayBudgetReductionLogに記録
      await withDatabaseRetry(
        () =>
          this.prisma.intradayBudgetReductionLog.create({
            data: {
              adgroupId: result.adgroupId,
              campaignId: isCBO ? result.campaignId : null,
              advertiserId,
              reductionDate: today,
              reductionTime: new Date(),
              originalBudget,
              reducedBudget,
              reductionRate: this.BUDGET_REDUCTION_RATE,
              isCBO,
            },
          }),
        { logger: this.logger, context: 'IntradayBudgetReductionLog create' },
      );

      // ChangeLogに記録
      await this.logChange(
        isCBO ? 'CAMPAIGN' : 'ADGROUP',
        entityId,
        'INTRADAY_BUDGET_REDUCE',
        'INTRADAY_OPTIMIZATION',
        { budget: originalBudget },
        { budget: reducedBudget },
        result.reason,
      );

      // 通知作成
      await this.createBudgetReduceNotification(result, advertiserId, originalBudget, reducedBudget);

      this.logger.log(`Reduced budget for ${isCBO ? 'campaign' : 'adgroup'} ${entityId}: ¥${originalBudget} → ¥${reducedBudget}`);
    } catch (error) {
      this.logger.error(`[IC-03] Failed to reduce budget for adgroup ${result.adgroupId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * 配信再開の実行
   */
  async executeIntradayResume() {
    const today = this.getTodayJST();

    // 本日停止&未再開の広告を取得
    const pauseLogs = await this.prisma.intradayPauseLog.findMany({
      where: {
        pauseDate: today,
        resumed: false,
      },
    });

    if (pauseLogs.length === 0) {
      this.logger.log('No ads to resume');
      return;
    }

    this.logger.log(`Found ${pauseLogs.length} ads to resume`);

    let resumed = 0;
    let failed = 0;

    for (const log of pauseLogs) {
      try {
        // OAuth Token取得
        const token = await this.prisma.oAuthToken.findUnique({
          where: { advertiserId: log.advertiserId },
        });

        if (!token) {
          this.logger.warn(`No token for advertiser ${log.advertiserId}`);
          continue;
        }

        // 広告を再開
        await this.tiktokService.updateAdStatus(log.advertiserId, token.accessToken, [log.adId], 'ENABLE');

        // ログ更新
        await this.prisma.intradayPauseLog.update({
          where: { id: log.id },
          data: {
            resumed: true,
            resumeTime: new Date(),
          },
        });

        // ChangeLog記録
        await this.logChange('AD', log.adId, 'INTRADAY_RESUME', 'INTRADAY_OPTIMIZATION', { status: 'DISABLE' }, { status: 'ENABLE' }, '23:59自動再開');

        resumed++;
        this.logger.log(`Resumed ad ${log.adId}`);
      } catch (error) {
        this.logger.error(`[IR-02] Failed to resume ad ${log.adId}: ${error.message}`);
        failed++;
      }
    }

    this.logger.log(`Intraday resume completed. Resumed: ${resumed}, Failed: ${failed}`);
  }

  /**
   * 予算復元の実行
   */
  async executeIntradayBudgetRestore() {
    const today = this.getTodayJST();

    // 本日削減&未復元を取得
    const reductionLogs = await this.prisma.intradayBudgetReductionLog.findMany({
      where: {
        reductionDate: today,
        restored: false,
      },
    });

    if (reductionLogs.length === 0) {
      this.logger.log('No budgets to restore');
      return;
    }

    this.logger.log(`Found ${reductionLogs.length} budgets to restore`);

    let restored = 0;
    let failed = 0;

    for (const log of reductionLogs) {
      try {
        // OAuth Token取得
        const token = await this.prisma.oAuthToken.findUnique({
          where: { advertiserId: log.advertiserId },
        });

        if (!token) {
          this.logger.warn(`No token for advertiser ${log.advertiserId}`);
          continue;
        }

        // 予算を復元
        if (log.isCBO && log.campaignId) {
          await this.tiktokService.updateCampaign(log.advertiserId, token.accessToken, log.campaignId, {
            budget: log.originalBudget,
          });
        } else {
          await this.tiktokService.updateAdGroup(log.advertiserId, token.accessToken, log.adgroupId, {
            budget: log.originalBudget,
          });
        }

        // ログ更新
        await this.prisma.intradayBudgetReductionLog.update({
          where: { id: log.id },
          data: {
            restored: true,
            restoreTime: new Date(),
          },
        });

        // ChangeLog記録
        const entityType = log.isCBO ? 'CAMPAIGN' : 'ADGROUP';
        const entityId = log.isCBO ? log.campaignId : log.adgroupId;
        await this.logChange(
          entityType,
          entityId!,
          'INTRADAY_BUDGET_RESTORE',
          'INTRADAY_OPTIMIZATION',
          { budget: log.reducedBudget },
          { budget: log.originalBudget },
          '翌0:00自動復元',
        );

        restored++;
        this.logger.log(`Restored budget for ${entityType} ${entityId}: ¥${log.reducedBudget} → ¥${log.originalBudget}`);
      } catch (error) {
        this.logger.error(`[IB-02] Failed to restore budget for ${log.adgroupId}: ${error.message}`);
        failed++;
      }
    }

    this.logger.log(`Intraday budget restore completed. Restored: ${restored}, Failed: ${failed}`);
  }

  /**
   * ChangeLog記録
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
    await withDatabaseRetry(
      () =>
        this.prisma.changeLog.create({
          data: {
            entityType,
            entityId,
            action,
            source,
            beforeData,
            afterData,
            reason,
          },
        }),
      { logger: this.logger, context: 'ChangeLog create' },
    );
  }

  /**
   * 停止通知を作成
   */
  private async createPauseNotification(result: IntradayCheckResult, advertiserId: string) {
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: advertiserId },
    });

    if (!advertiser) return;

    const message =
      result.todayCPA !== null
        ? `広告「${result.adName}」を一時停止しました\n当日CPA: ¥${result.todayCPA.toFixed(0)}（許容CPAを超過）\n23:59に自動再開予定`
        : `広告「${result.adName}」を一時停止しました\n当日CV: 0件（前日CPA: ¥${result.yesterdayCPA?.toFixed(0) || '-'} → CVR悪化の兆候）\n23:59に自動再開予定`;

    await this.notificationService.createNotification({
      type: 'INTRADAY_CPA_PAUSE' as any,
      severity: NotificationSeverity.WARNING,
      advertiserId: advertiser.id,
      entityType: EntityType.AD,
      entityId: result.adId,
      title: '日中CPAチェック: 広告一時停止',
      message,
      metadata: {
        todaySpend: result.todaySpend,
        todayCPA: result.todayCPA,
        yesterdayCPA: result.yesterdayCPA,
        todayCV: result.todayCV,
      },
    });
  }

  /**
   * 予算削減通知を作成
   */
  private async createBudgetReduceNotification(
    result: IntradayCheckResult,
    advertiserId: string,
    originalBudget: number,
    reducedBudget: number,
  ) {
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: advertiserId },
    });

    if (!advertiser) return;

    const message = `広告「${result.adName}」の予算を50%削減しました\n当日CPA: ¥${result.todayCPA?.toFixed(0) || '-'}\n現在予算: ¥${originalBudget.toLocaleString()} → ¥${reducedBudget.toLocaleString()}\n翌0:00に自動復元予定`;

    await this.notificationService.createNotification({
      type: 'INTRADAY_BUDGET_REDUCED' as any,
      severity: NotificationSeverity.INFO,
      advertiserId: advertiser.id,
      entityType: EntityType.ADGROUP,
      entityId: result.adgroupId,
      title: '日中CPAチェック: 予算削減',
      message,
      metadata: {
        todaySpend: result.todaySpend,
        todayCPA: result.todayCPA,
        originalBudget,
        reducedBudget,
      },
    });
  }

  /**
   * 除外Advertiserリストを取得
   */
  private getExcludedAdvertisers(): string[] {
    const excluded = this.configService.get('INTRADAY_EXCLUDED_ADVERTISERS') || '';
    return excluded.split(',').map((id: string) => id.trim()).filter((id: string) => id);
  }

  /**
   * 今日の日付（JST、時刻00:00:00）を取得
   */
  private getTodayJST(): Date {
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    const jstNow = new Date(now.getTime() + jstOffset);
    jstNow.setUTCHours(0, 0, 0, 0);
    return jstNow;
  }

  /**
   * 日付を文字列に変換（YYYY-MM-DD）
   */
  private formatDateStr(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
