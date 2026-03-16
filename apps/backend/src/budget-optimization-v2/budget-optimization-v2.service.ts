import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TiktokService } from '../tiktok/tiktok.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { AppealService } from '../appeal/appeal.service';
import { AdBudgetCapService } from '../ad-performance/ad-budget-cap.service';
import { ConfigService } from '@nestjs/config';
import {
  validateAdNameFormat,
  batchJobLock,
  withDatabaseRetry,
} from '../common/utils';
import {
  BUDGET_INCREASE_RATE,
  BUDGET_DECREASE_RATE,
  BUDGET_TIER,
  BUDGET_TIER_MIN_OPTS,
  OPERATION_HOURS,
  MIN_IMPRESSIONS_FOR_PAUSE,
  SNAPSHOT_RETENTION_DAYS,
  TIKTOK_BUDGET_LIMITS,
  DEFAULT_DAILY_BUDGET,
  DAILY_REPORT_SPREADSHEET_ID,
  DAILY_REPORT_SHEET_NAME,
  INDIVIDUAL_RESERVATION_SPREADSHEET_ID,
  INDIVIDUAL_RESERVATION_CONFIG,
  detectChannelType,
  usesFrontCPO,
  type ChannelType,
  type V2SmartPlusAd,
  type TodayMetrics,
  type Last7DaysMetrics,
  type BudgetAction,
  type BudgetIncreaseDecision,
  type PauseAction,
  type PauseDecision,
  type HourlyExecutionResult,
  type BudgetResetResult,
  type BudgetResetAdResult,
  type BudgetResetAction,
} from './types';

@Injectable()
export class BudgetOptimizationV2Service {
  private readonly logger = new Logger(BudgetOptimizationV2Service.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tiktokService: TiktokService,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly appealService: AppealService,
    private readonly adBudgetCapService: AdBudgetCapService,
    private readonly configService: ConfigService,
  ) {}

  // ============================================================================
  // メインエントリ
  // ============================================================================

  /**
   * 毎時予算調整を実行
   */
  async executeHourlyOptimization(
    advertiserId: string,
    accessToken: string,
    dryRun: boolean = false,
  ): Promise<HourlyExecutionResult> {
    const now = new Date();
    const jstHour = this.getJSTHour(now);
    const jstDateStr = this.getJSTDateString(now);

    this.logger.log(
      `[V2] Starting hourly optimization for ${advertiserId} (JST hour: ${jstHour}, dryRun: ${dryRun})`,
    );

    // 20:00以降は実行しない
    if (jstHour > OPERATION_HOURS.LAST_HOUR) {
      this.logger.log(`[V2] Skipping: outside operation hours (JST ${jstHour}:00 > ${OPERATION_HOURS.LAST_HOUR}:00)`);
      return this.emptyResult(advertiserId, now);
    }

    // Google Sheetsキャッシュクリア
    this.googleSheetsService.clearCache();

    // Advertiser & Appeal取得
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: advertiserId },
      include: { appeal: true },
    });

    if (!advertiser || !advertiser.appeal) {
      throw new Error(`Advertiser ${advertiserId} not found or no appeal assigned`);
    }

    const appeal = advertiser.appeal;

    // Smart+配信中広告を取得
    const activeAds = await this.getActiveSmartPlusAds(advertiserId, accessToken, appeal);
    this.logger.log(`[V2] Found ${activeAds.length} active Smart+ ads`);

    if (activeAds.length === 0) {
      return this.emptyResult(advertiserId, now);
    }

    // 第1回か第2回以降か判定
    const isFirstRound = await this.isFirstRoundToday(advertiserId, jstDateStr);
    this.logger.log(`[V2] isFirstRound: ${isFirstRound}`);

    let stage1Results: BudgetIncreaseDecision[] = [];
    let stage2Results: PauseDecision[] = [];

    if (isFirstRound) {
      // 第1回：第1段階（当日CPA増額）+ 第2段階（停止判定）
      stage1Results = await this.executeStage1(
        activeAds, appeal, advertiserId, accessToken, jstDateStr, dryRun,
      );
      stage2Results = await this.executeStage2(
        activeAds, appeal, advertiserId, accessToken, jstDateStr, dryRun,
      );
    } else {
      // 第2回以降：差分CV増額のみ
      stage1Results = await this.executeSubsequentRound(
        activeAds, appeal, advertiserId, accessToken, jstDateStr, dryRun,
      );
    }

    // Snapshot記録
    await this.saveSnapshots(advertiserId, activeAds, stage1Results, now);

    // 古いSnapshot削除
    await this.cleanupOldSnapshots();

    const result: HourlyExecutionResult = {
      advertiserId,
      executionTime: now.toISOString(),
      isFirstRound,
      stage1Results,
      stage2Results,
      summary: {
        totalAds: activeAds.length,
        increased: stage1Results.filter(r => r.action === 'INCREASE').length,
        continued: stage1Results.filter(r => r.action === 'CONTINUE').length,
        paused: stage2Results.filter(r => r.action === 'PAUSE').length,
        skipped: stage1Results.filter(r => r.action === 'SKIP').length
          + stage2Results.filter(r => r.action === 'SKIP_NEW_CR').length,
        budgetDecreased: stage2Results.filter(r => r.action === 'BUDGET_DECREASE_20PCT').length,
      },
    };

    this.logger.log(
      `[V2] Completed: increased=${result.summary.increased}, continued=${result.summary.continued}, paused=${result.summary.paused}, budgetDecreased=${result.summary.budgetDecreased}, skipped=${result.summary.skipped}`,
    );

    return result;
  }

  /**
   * 全対象アカウントに対して毎時予算調整を実行
   */
  async executeAll(accessToken: string, dryRun: boolean = false) {
    const jobName = 'budget-optimization-v2';
    if (!batchJobLock.acquire(jobName, 1800000)) {
      this.logger.warn('[V2] Previous job is still running. Skipping...');
      return { success: false, reason: 'JOB_LOCKED' };
    }

    try {
      const advertiserIds = await this.getTargetAdvertiserIds();
      const results: HourlyExecutionResult[] = [];

      for (const advertiserId of advertiserIds) {
        try {
          const result = await this.executeHourlyOptimization(advertiserId, accessToken, dryRun);
          results.push(result);
        } catch (error) {
          this.logger.error(`[V2] Failed for advertiser ${advertiserId}:`, error);
          results.push(this.emptyResult(advertiserId, new Date()));
        }
      }

      return { success: true, dryRun, results };
    } finally {
      batchJobLock.release(jobName);
    }
  }

  // ============================================================================
  // 日次レポート書き出し
  // ============================================================================

  async writeDailyReportToSheet(results: HourlyExecutionResult[]): Promise<void> {
    const firstRoundResults = results.filter(r => r.isFirstRound);
    if (firstRoundResults.length === 0) {
      this.logger.log('[V2-Report] No first-round results. Skipping daily report.');
      return;
    }

    const now = new Date();
    const dateStr = this.getJSTDateString(now);
    const rows: string[][] = [];

    for (const result of firstRoundResults) {
      // Advertiser & Appeal名取得
      const advertiser = await this.prisma.advertiser.findUnique({
        where: { tiktokAdvertiserId: result.advertiserId },
        include: { appeal: true },
      });
      const appealName = advertiser?.appeal?.name ?? result.advertiserId;
      const channelType = detectChannelType(appealName);

      // Stage1をadIdでMap化
      const stage1Map = new Map(result.stage1Results.map(r => [r.adId, r]));

      // Stage2の全広告をベースにループ（Stage2が全広告のメトリクスを持つ）
      if (result.stage2Results.length > 0) {
        for (const s2 of result.stage2Results) {
          const s1 = stage1Map.get(s2.adId);
          rows.push([
            dateStr,
            appealName,
            channelType,
            s2.adName,
            s1 ? String(s1.currentBudget) : '',
            s1 ? s1.action : '',
            s1?.newBudget != null ? String(s1.newBudget) : '',
            s1?.todayCPA != null ? String(Math.round(s1.todayCPA)) : '',
            s1 ? String(s1.todayCV) : '',
            s1 ? String(Math.round(s1.todaySpend)) : '',
            s2.last7DaysCPA != null ? String(Math.round(s2.last7DaysCPA)) : '',
            s2.last7DaysFrontCPO != null ? String(Math.round(s2.last7DaysFrontCPO)) : '',
            s2.last7DaysIndividualReservationCPO != null ? String(Math.round(s2.last7DaysIndividualReservationCPO)) : '',
            String(Math.round(s2.last7DaysSpend)),
            String(s2.last7DaysCVCount),
            String(s2.last7DaysFrontSalesCount),
            String(s2.last7DaysIndividualReservationCount),
            s2.action,
            s2.reason,
          ]);
        }
      } else {
        // Stage2がない場合（第1回だがStage2結果が空の場合）Stage1のみ出力
        for (const s1 of result.stage1Results) {
          rows.push([
            dateStr,
            appealName,
            channelType,
            s1.adName,
            String(s1.currentBudget),
            s1.action,
            s1.newBudget != null ? String(s1.newBudget) : '',
            s1.todayCPA != null ? String(Math.round(s1.todayCPA)) : '',
            String(s1.todayCV),
            String(Math.round(s1.todaySpend)),
            '', '', '', '', '', '', '', '', '',
          ]);
        }
      }
    }

    if (rows.length === 0) {
      this.logger.log('[V2-Report] No rows to write.');
      return;
    }

    // ヘッダー行チェック（シートが空の場合のみヘッダーを書き出し）
    try {
      const existing = await this.googleSheetsService.getValues(
        DAILY_REPORT_SPREADSHEET_ID,
        `'${DAILY_REPORT_SHEET_NAME}'!A1`,
      );
      if (!existing || existing.length === 0 || !existing[0]?.[0]) {
        const headers = [
          '日付', 'アカウント', '導線', '広告名', '日予算',
          '予算アクション', '新予算', '当日CPA', '当日CV', '当日広告費',
          '7日CPA', '7日フロントCPO', '7日個別予約CPO', '7日広告費',
          '7日CV', '7日フロント販売数', '7日個別予約数', '停止判定', '判定理由',
        ];
        await this.googleSheetsService.appendValues(
          DAILY_REPORT_SPREADSHEET_ID,
          `'${DAILY_REPORT_SHEET_NAME}'!A:S`,
          [headers],
        );
      }
    } catch (error) {
      this.logger.warn('[V2-Report] Header check failed, proceeding with data:', error);
    }

    // データ書き出し
    await this.googleSheetsService.appendValues(
      DAILY_REPORT_SPREADSHEET_ID,
      `'${DAILY_REPORT_SHEET_NAME}'!A:S`,
      rows,
    );

    this.logger.log(`[V2-Report] Wrote ${rows.length} rows to daily report sheet.`);
  }

  // ============================================================================
  // 予算調整除外CRリスト取得
  // ============================================================================

  private async getExcludedCreativeNames(advertiserId: string): Promise<Set<string>> {
    const now = new Date();
    const exclusions = await this.prisma.budgetOptimizationExclusion.findMany({
      where: {
        enabled: true,
        AND: [
          {
            OR: [
              { advertiserId: null },
              { advertiserId: advertiserId },
            ],
          },
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: now } },
            ],
          },
        ],
      },
    });
    return new Set(exclusions.map(e => e.creativeName));
  }

  // ============================================================================
  // 第1段階：当日CPA基準の予算増額
  // ============================================================================

  private async executeStage1(
    ads: V2SmartPlusAd[],
    appeal: any,
    advertiserId: string,
    accessToken: string,
    todayStr: string,
    dryRun: boolean,
  ): Promise<BudgetIncreaseDecision[]> {
    this.logger.log('[V2] === Stage 1: Today CPA budget increase ===');

    // 当日メトリクスをTikTok APIから取得
    const todayMetrics = await this.getTodayMetrics(advertiserId, accessToken, todayStr);

    // 除外CRリストを取得
    const excludedCRs = await this.getExcludedCreativeNames(advertiserId);

    const results: BudgetIncreaseDecision[] = [];

    for (const ad of ads) {
      try {
        if (!ad.parsedName) {
          results.push(this.skipDecision(ad, '広告名パース不可'));
          continue;
        }

        // 予算調整除外チェック
        if (excludedCRs.has(ad.parsedName.creativeName)) {
          this.logger.log(`[V2] Ad ${ad.adId} (${ad.adName}): 予算調整除外 CR名=${ad.parsedName.creativeName} → SKIP`);
          results.push(this.skipDecision(ad, `予算調整除外: CR名=${ad.parsedName.creativeName}`));
          continue;
        }

        // スプレッドシートから当日CV数を取得
        const registrationPath = this.generateRegistrationPath(ad.parsedName.lpName, appeal.name);
        const todayStart = this.parseJSTDate(todayStr);
        const todayEnd = this.parseJSTDateEnd(todayStr);
        const todayCV = await this.googleSheetsService.getCVCount(
          appeal.name,
          appeal.cvSpreadsheetUrl,
          registrationPath,
          todayStart,
          todayEnd,
        );

        if (todayCV < 1) {
          results.push(this.skipDecision(ad, `当日CV=0（登録経路: ${registrationPath}）`));
          continue;
        }

        // 当日広告費を取得
        const metrics = todayMetrics.get(ad.adId);
        const todaySpend = metrics?.spend || 0;

        // 当日CPA計算
        const todayCPA = todayCV > 0 ? todaySpend / todayCV : null;

        // 増額判定
        const decision = await this.evaluateBudgetIncrease(
          ad, todayCPA, todayCV, todaySpend, appeal.targetCPA, advertiserId,
        );
        results.push(decision);

        // 増額実行
        if (decision.action === 'INCREASE' && decision.newBudget && !dryRun) {
          await this.executeBudgetUpdate(ad, decision.newBudget, advertiserId, accessToken);
        }
      } catch (error) {
        this.logger.error(`[V2] Stage1 error for ad ${ad.adId}:`, error.message);
        results.push(this.skipDecision(ad, `エラー: ${error.message}`));
      }
    }

    return results;
  }

  // ============================================================================
  // 第2段階：過去7日間CPA/CPOによる停止判定
  // ============================================================================

  private async executeStage2(
    ads: V2SmartPlusAd[],
    appeal: any,
    advertiserId: string,
    accessToken: string,
    todayStr: string,
    dryRun: boolean,
  ): Promise<PauseDecision[]> {
    this.logger.log('[V2] === Stage 2: 7-day CPA/CPO pause evaluation ===');

    const channelType = detectChannelType(appeal.name);
    this.logger.log(`[V2] Channel type: ${channelType} (appeal: ${appeal.name})`);

    // 過去7日間の期間を計算（当日含む）
    const { startDate, endDate, startStr, endStr } = this.calculateLast7DaysPeriod(todayStr);

    // 過去7日間メトリクスをTikTok APIから取得
    const last7DaysMetrics = await this.getLast7DaysMetrics(advertiserId, accessToken, startStr, endStr);

    // 除外CRリストを取得
    const excludedCRs = await this.getExcludedCreativeNames(advertiserId);

    const results: PauseDecision[] = [];

    for (const ad of ads) {
      try {
        if (!ad.parsedName) {
          results.push({
            adId: ad.adId,
            adName: ad.adName,
            action: 'SKIP_NEW_CR',
            reason: '広告名パース不可',
            channelType,
            last7DaysSpend: 0,
            last7DaysImpressions: 0,
            last7DaysCVCount: 0,
            last7DaysFrontSalesCount: 0,
            last7DaysCPA: null,
            last7DaysFrontCPO: null,
            last7DaysIndividualReservationCount: 0,
            last7DaysIndividualReservationCPO: null,
          });
          continue;
        }

        // 予算調整除外チェック
        if (excludedCRs.has(ad.parsedName.creativeName)) {
          this.logger.log(`[V2] Ad ${ad.adId} (${ad.adName}): 予算調整除外 CR名=${ad.parsedName.creativeName} → SKIP`);
          results.push({
            adId: ad.adId,
            adName: ad.adName,
            action: 'SKIP_NEW_CR',
            reason: `予算調整除外: CR名=${ad.parsedName.creativeName}`,
            channelType,
            last7DaysSpend: 0,
            last7DaysImpressions: 0,
            last7DaysCVCount: 0,
            last7DaysFrontSalesCount: 0,
            last7DaysCPA: null,
            last7DaysFrontCPO: null,
            last7DaysIndividualReservationCount: 0,
            last7DaysIndividualReservationCPO: null,
          });
          continue;
        }

        const registrationPath = this.generateRegistrationPath(ad.parsedName.lpName, appeal.name);

        // 過去7日間の広告費・impを取得
        const metrics = last7DaysMetrics.get(ad.adId);
        const last7DaysSpend = metrics?.totalSpend || 0;
        const last7DaysImpressions = metrics?.totalImpressions || 0;

        // 新規CR保護チェック
        const allowableCPA = appeal.allowableCPA || 0;
        if (last7DaysSpend < allowableCPA && last7DaysImpressions < MIN_IMPRESSIONS_FOR_PAUSE) {
          results.push({
            adId: ad.adId,
            adName: ad.adName,
            action: 'SKIP_NEW_CR',
            reason: `新規CR保護: 広告費¥${last7DaysSpend.toFixed(0)} < 許容CPA¥${allowableCPA} かつ imp${last7DaysImpressions} < ${MIN_IMPRESSIONS_FOR_PAUSE}`,
            channelType,
            last7DaysSpend,
            last7DaysImpressions,
            last7DaysCVCount: 0,
            last7DaysFrontSalesCount: 0,
            last7DaysCPA: null,
            last7DaysFrontCPO: null,
            last7DaysIndividualReservationCount: 0,
            last7DaysIndividualReservationCPO: null,
          });
          continue;
        }

        const isWithin7Days = ad.parsedName && this.isWithin7DaysOfPublish(ad.parsedName.date, todayStr);

        // スプレッドシートから過去7日間のCV数を取得
        const last7DaysCVCount = await this.googleSheetsService.getCVCount(
          appeal.name,
          appeal.cvSpreadsheetUrl,
          registrationPath,
          startDate,
          endDate,
        );

        // フロント販売数（SNS/AI導線のみ）
        let last7DaysFrontSalesCount = 0;
        if (usesFrontCPO(channelType) && appeal.frontSpreadsheetUrl) {
          last7DaysFrontSalesCount = await this.googleSheetsService.getFrontSalesCount(
            appeal.name,
            appeal.frontSpreadsheetUrl,
            registrationPath,
            startDate,
            endDate,
          );
        }

        // 個別予約数を取得
        const individualReservationPath = this.generateIndividualReservationPath(
          ad.parsedName.lpName, ad.parsedName.creativeName, appeal.name,
        );
        let last7DaysIndividualReservationCount = 0;
        try {
          last7DaysIndividualReservationCount = await this.googleSheetsService.getIndividualReservationCount(
            channelType,
            INDIVIDUAL_RESERVATION_SPREADSHEET_ID,
            individualReservationPath,
            startDate,
            endDate,
          );
        } catch (error) {
          this.logger.warn(`[V2] Failed to get individual reservation count for ad ${ad.adId}: ${error.message}`);
        }

        // CPA / フロントCPO / 個別予約CPO計算
        const last7DaysCPA = last7DaysCVCount > 0 ? last7DaysSpend / last7DaysCVCount : null;
        const last7DaysFrontCPO = last7DaysFrontSalesCount > 0 ? last7DaysSpend / last7DaysFrontSalesCount : null;
        const last7DaysIndividualReservationCPO = last7DaysIndividualReservationCount > 0
          ? last7DaysSpend / last7DaysIndividualReservationCount : null;

        // 既存のCPA/フロントCPO停止判定
        let decision = this.evaluatePauseDecision(
          ad, channelType, appeal,
          last7DaysSpend, last7DaysImpressions,
          last7DaysCVCount, last7DaysFrontSalesCount,
          last7DaysCPA, last7DaysFrontCPO,
          last7DaysIndividualReservationCount,
          last7DaysIndividualReservationCPO,
        );

        // 既存判定がCONTINUEの場合 → 個別予約CPO判定を追加実行（出稿7日以内は個別予約CPO判定スキップ）
        if (decision.action === 'CONTINUE' && appeal.allowableIndividualReservationCPO) {
          if (isWithin7Days) {
            this.logger.log(
              `[V2] Ad ${ad.adId} (${ad.adName}): 出稿7日以内保護 (出稿日=${ad.parsedName.date}) → 個別予約CPO判定スキップ`,
            );
          } else {
            decision = this.evaluateIndividualReservationCPO(
              ad, channelType, appeal,
              last7DaysSpend, last7DaysImpressions,
              last7DaysCVCount, last7DaysFrontSalesCount,
              last7DaysCPA, last7DaysFrontCPO,
              last7DaysIndividualReservationCount,
              last7DaysIndividualReservationCPO,
              appeal.allowableIndividualReservationCPO,
            );
          }
        }

        results.push(decision);

        // アクション実行
        if (!dryRun) {
          if (decision.action === 'PAUSE') {
            await this.executeAdPause(ad, decision.reason, advertiserId, accessToken);
          } else if (decision.action === 'BUDGET_DECREASE_20PCT') {
            const newBudget = await this.executeBudgetDecrease(ad, decision.reason, advertiserId, accessToken);
            decision.newBudgetAfterDecrease = newBudget;
          }
        }
      } catch (error) {
        this.logger.error(`[V2] Stage2 error for ad ${ad.adId}:`, error.message);
        results.push({
          adId: ad.adId,
          adName: ad.adName,
          action: 'CONTINUE',
          reason: `エラー: ${error.message}`,
          channelType,
          last7DaysSpend: 0,
          last7DaysImpressions: 0,
          last7DaysCVCount: 0,
          last7DaysFrontSalesCount: 0,
          last7DaysCPA: null,
          last7DaysFrontCPO: null,
          last7DaysIndividualReservationCount: 0,
          last7DaysIndividualReservationCPO: null,
        });
      }
    }

    return results;
  }

  // ============================================================================
  // 第2回以降：差分CV基準の予算増額
  // ============================================================================

  private async executeSubsequentRound(
    ads: V2SmartPlusAd[],
    appeal: any,
    advertiserId: string,
    accessToken: string,
    todayStr: string,
    dryRun: boolean,
  ): Promise<BudgetIncreaseDecision[]> {
    this.logger.log('[V2] === Subsequent round: Delta CV budget increase ===');

    // 当日メトリクスを取得
    const todayMetrics = await this.getTodayMetrics(advertiserId, accessToken, todayStr);

    // 前回のSnapshotを取得（当日分で最新のもの）
    const lastSnapshots = await this.getLastSnapshots(advertiserId, todayStr);

    // 除外CRリストを取得
    const excludedCRs = await this.getExcludedCreativeNames(advertiserId);

    const results: BudgetIncreaseDecision[] = [];

    for (const ad of ads) {
      try {
        if (!ad.parsedName) {
          results.push(this.skipDecision(ad, '広告名パース不可'));
          continue;
        }

        // 予算調整除外チェック
        if (excludedCRs.has(ad.parsedName.creativeName)) {
          this.logger.log(`[V2] Ad ${ad.adId} (${ad.adName}): 予算調整除外 CR名=${ad.parsedName.creativeName} → SKIP`);
          results.push(this.skipDecision(ad, `予算調整除外: CR名=${ad.parsedName.creativeName}`));
          continue;
        }

        const registrationPath = this.generateRegistrationPath(ad.parsedName.lpName, appeal.name);
        const todayStart = this.parseJSTDate(todayStr);
        const todayEnd = this.parseJSTDateEnd(todayStr);
        const todayCV = await this.googleSheetsService.getCVCount(
          appeal.name,
          appeal.cvSpreadsheetUrl,
          registrationPath,
          todayStart,
          todayEnd,
        );

        // 前回SnapshotからのCV増加チェック
        const lastSnapshot = lastSnapshots.get(ad.adId);
        const lastCVCount = lastSnapshot?.todayCVCount || 0;

        if (todayCV <= lastCVCount) {
          // 実際のCV数を渡してスナップショットに正しく保存する
          // （todayCV=0で保存すると次回ラウンドで同じCVが再検出されるバグを防止）
          const metrics = todayMetrics.get(ad.adId);
          const spend = metrics?.spend || 0;
          results.push(this.skipDecision(ad, `CV増加なし（前回: ${lastCVCount}, 現在: ${todayCV}）`, todayCV, spend));
          continue;
        }

        this.logger.log(
          `[V2] Ad ${ad.adId} CV increased: ${lastCVCount} → ${todayCV}`,
        );

        // 当日広告費を取得
        const metrics = todayMetrics.get(ad.adId);
        const todaySpend = metrics?.spend || 0;
        const todayCPA = todayCV > 0 ? todaySpend / todayCV : null;

        // 増額判定
        const decision = await this.evaluateBudgetIncrease(
          ad, todayCPA, todayCV, todaySpend, appeal.targetCPA, advertiserId,
        );
        results.push(decision);

        // 増額実行
        if (decision.action === 'INCREASE' && decision.newBudget && !dryRun) {
          await this.executeBudgetUpdate(ad, decision.newBudget, advertiserId, accessToken);
        }
      } catch (error) {
        this.logger.error(`[V2] SubsequentRound error for ad ${ad.adId}:`, error.message);
        results.push(this.skipDecision(ad, `エラー: ${error.message}`));
      }
    }

    return results;
  }

  // ============================================================================
  // 増額判定ロジック（共通）
  // ============================================================================

  private async evaluateBudgetIncrease(
    ad: V2SmartPlusAd,
    todayCPA: number | null,
    todayCV: number,
    todaySpend: number,
    targetCPA: number,
    advertiserId: string,
  ): Promise<BudgetIncreaseDecision> {
    const currentBudget = ad.dailyBudget;
    const base = { adId: ad.adId, adName: ad.adName, currentBudget, todayCPA, todayCV, todaySpend };

    // 当日CPA > 目標CPA → 継続
    if (todayCPA === null || todayCPA > targetCPA) {
      return {
        ...base,
        action: 'CONTINUE',
        reason: todayCPA === null
          ? '当日CPA算出不可（広告費0）'
          : `当日CPA ¥${todayCPA.toFixed(0)} > 目標CPA ¥${targetCPA}`,
      };
    }

    // 当日CPA ≤ 目標CPA → 予算帯別ルール
    let canIncrease = false;
    let reason = '';

    if (currentBudget < BUDGET_TIER.LOW_MAX) {
      // 8,000円未満 → 無条件で1.3倍
      canIncrease = true;
      reason = `日予算¥${currentBudget.toFixed(0)} < ¥${BUDGET_TIER.LOW_MAX}、CPA¥${todayCPA.toFixed(0)} ≤ 目標¥${targetCPA}`;
    } else if (currentBudget <= BUDGET_TIER.MID_MAX) {
      // 8,000〜20,000円 → オプト2以上
      if (todayCV >= BUDGET_TIER_MIN_OPTS.MID) {
        canIncrease = true;
        reason = `日予算¥${currentBudget.toFixed(0)}、オプト${todayCV} ≥ ${BUDGET_TIER_MIN_OPTS.MID}`;
      } else {
        reason = `日予算¥${currentBudget.toFixed(0)}、オプト${todayCV} < ${BUDGET_TIER_MIN_OPTS.MID}`;
      }
    } else {
      // 20,000円超 → オプト3以上
      if (todayCV >= BUDGET_TIER_MIN_OPTS.HIGH) {
        canIncrease = true;
        reason = `日予算¥${currentBudget.toFixed(0)}、オプト${todayCV} ≥ ${BUDGET_TIER_MIN_OPTS.HIGH}`;
      } else {
        reason = `日予算¥${currentBudget.toFixed(0)}、オプト${todayCV} < ${BUDGET_TIER_MIN_OPTS.HIGH}`;
      }
    }

    if (!canIncrease) {
      return { ...base, action: 'CONTINUE', reason: `オプト数不足: ${reason}` };
    }

    // 新予算を計算
    let newBudget = Math.round(currentBudget * BUDGET_INCREASE_RATE);

    // AdBudgetCapチェック
    const budgetCap = await this.getEffectiveBudgetCap(ad.adId, advertiserId);
    if (budgetCap !== null && newBudget > budgetCap) {
      if (currentBudget >= budgetCap) {
        return {
          ...base,
          action: 'CONTINUE',
          reason: `AdBudgetCap ¥${budgetCap} に到達済み`,
        };
      }
      newBudget = budgetCap;
      reason += ` → AdBudgetCap ¥${budgetCap} で制限`;
    }

    // TikTok API制限チェック
    newBudget = Math.max(TIKTOK_BUDGET_LIMITS.MIN, Math.min(TIKTOK_BUDGET_LIMITS.MAX, newBudget));

    return {
      ...base,
      action: 'INCREASE',
      reason: `増額: ${reason}`,
      newBudget,
    };
  }

  // ============================================================================
  // 停止判定ロジック
  // ============================================================================

  private evaluatePauseDecision(
    ad: V2SmartPlusAd,
    channelType: ChannelType,
    appeal: any,
    last7DaysSpend: number,
    last7DaysImpressions: number,
    last7DaysCVCount: number,
    last7DaysFrontSalesCount: number,
    last7DaysCPA: number | null,
    last7DaysFrontCPO: number | null,
    last7DaysIndividualReservationCount: number = 0,
    last7DaysIndividualReservationCPO: number | null = null,
  ): PauseDecision {
    const base = {
      adId: ad.adId,
      adName: ad.adName,
      channelType,
      last7DaysSpend,
      last7DaysImpressions,
      last7DaysCVCount,
      last7DaysFrontSalesCount,
      last7DaysCPA,
      last7DaysFrontCPO,
      last7DaysIndividualReservationCount,
      last7DaysIndividualReservationCPO,
    };

    if (usesFrontCPO(channelType)) {
      // SNS/AI導線: フロントCPO判定
      const allowableFrontCPO = appeal.allowableFrontCPO;
      const allowableCPA = appeal.allowableCPA;

      if (last7DaysFrontSalesCount >= 1) {
        // フロント販売あり → フロントCPOで判定
        if (last7DaysFrontCPO !== null && last7DaysFrontCPO > allowableFrontCPO) {
          return {
            ...base,
            action: 'PAUSE',
            reason: `フロントCPO ¥${last7DaysFrontCPO.toFixed(0)} > 許容値 ¥${allowableFrontCPO}`,
          };
        }
        return {
          ...base,
          action: 'CONTINUE',
          reason: `フロントCPO ¥${(last7DaysFrontCPO || 0).toFixed(0)} ≤ 許容値 ¥${allowableFrontCPO}`,
        };
      }

      // フロント販売なし
      if (last7DaysCVCount === 0) {
        return {
          ...base,
          action: 'PAUSE',
          reason: '過去7日間CV=0、フロント販売=0',
        };
      }

      // フロント販売0だがCV>0
      // まず広告費が許容フロントCPO以上消化していたら停止
      if (allowableFrontCPO && last7DaysSpend >= allowableFrontCPO) {
        return {
          ...base,
          action: 'PAUSE',
          reason: `フロント販売0、広告費 ¥${last7DaysSpend.toFixed(0)} ≥ 許容フロントCPO ¥${allowableFrontCPO}（フロント販売未発生）`,
        };
      }

      // CPAフォールバック
      if (last7DaysCPA !== null && last7DaysCPA > allowableCPA) {
        return {
          ...base,
          action: 'PAUSE',
          reason: `フロント販売0、CPA ¥${last7DaysCPA.toFixed(0)} > 許容CPA ¥${allowableCPA}（フォールバック）`,
        };
      }
      return {
        ...base,
        action: 'CONTINUE',
        reason: `フロント販売0、CPA ¥${(last7DaysCPA || 0).toFixed(0)} ≤ 許容CPA ¥${allowableCPA}`,
      };
    }

    // スキルプラス（セミナー）導線: CPA判定
    const allowableCPA = appeal.allowableCPA;

    if (last7DaysCVCount === 0) {
      return {
        ...base,
        action: 'PAUSE',
        reason: '過去7日間CV=0',
      };
    }

    if (last7DaysCPA !== null && last7DaysCPA > allowableCPA) {
      return {
        ...base,
        action: 'PAUSE',
        reason: `CPA ¥${last7DaysCPA.toFixed(0)} > 許容CPA ¥${allowableCPA}`,
      };
    }

    return {
      ...base,
      action: 'CONTINUE',
      reason: `CPA ¥${(last7DaysCPA || 0).toFixed(0)} ≤ 許容CPA ¥${allowableCPA}`,
    };
  }

  // ============================================================================
  // 個別予約CPO判定
  // ============================================================================

  /**
   * 個別予約CPOによる追加判定
   * 既存のCPA/フロントCPO判定でCONTINUEの場合にのみ呼ばれる
   */
  private evaluateIndividualReservationCPO(
    ad: V2SmartPlusAd,
    channelType: ChannelType,
    appeal: any,
    last7DaysSpend: number,
    last7DaysImpressions: number,
    last7DaysCVCount: number,
    last7DaysFrontSalesCount: number,
    last7DaysCPA: number | null,
    last7DaysFrontCPO: number | null,
    last7DaysIndividualReservationCount: number,
    last7DaysIndividualReservationCPO: number | null,
    allowableIndividualReservationCPO: number,
  ): PauseDecision {
    const base = {
      adId: ad.adId,
      adName: ad.adName,
      channelType,
      last7DaysSpend,
      last7DaysImpressions,
      last7DaysCVCount,
      last7DaysFrontSalesCount,
      last7DaysCPA,
      last7DaysFrontCPO,
      last7DaysIndividualReservationCount,
      last7DaysIndividualReservationCPO,
    };

    if (last7DaysIndividualReservationCount === 0) {
      // 個別予約0件: 広告費ベースで判定
      if (last7DaysSpend >= allowableIndividualReservationCPO) {
        this.logger.log(
          `[V2] Ad ${ad.adId}: 個別予約0件、広告費 ¥${last7DaysSpend.toFixed(0)} ≥ 許容個別予約CPO ¥${allowableIndividualReservationCPO} → PAUSE`,
        );
        return {
          ...base,
          action: 'PAUSE',
          reason: `個別予約0件、広告費 ¥${last7DaysSpend.toFixed(0)} ≥ 許容個別予約CPO ¥${allowableIndividualReservationCPO}`,
        };
      }
      return {
        ...base,
        action: 'CONTINUE',
        reason: `個別予約0件、広告費 ¥${last7DaysSpend.toFixed(0)} < 許容個別予約CPO ¥${allowableIndividualReservationCPO}（継続）`,
      };
    }

    // 個別予約1件以上: CPOで判定
    if (last7DaysIndividualReservationCPO !== null && last7DaysIndividualReservationCPO > allowableIndividualReservationCPO) {
      const newBudget = Math.max(
        TIKTOK_BUDGET_LIMITS.MIN,
        Math.floor(ad.dailyBudget * BUDGET_DECREASE_RATE),
      );
      this.logger.log(
        `[V2] Ad ${ad.adId}: 個別予約CPO ¥${last7DaysIndividualReservationCPO.toFixed(0)} > 許容 ¥${allowableIndividualReservationCPO} → 予算20%ダウン (¥${ad.dailyBudget} → ¥${newBudget})`,
      );
      return {
        ...base,
        action: 'BUDGET_DECREASE_20PCT',
        reason: `個別予約CPO ¥${last7DaysIndividualReservationCPO.toFixed(0)} > 許容 ¥${allowableIndividualReservationCPO}（予算20%ダウン）`,
        newBudgetAfterDecrease: newBudget,
      };
    }

    return {
      ...base,
      action: 'CONTINUE',
      reason: `個別予約CPO ¥${(last7DaysIndividualReservationCPO || 0).toFixed(0)} ≤ 許容 ¥${allowableIndividualReservationCPO}（継続）`,
    };
  }

  // ============================================================================
  // データ取得
  // ============================================================================

  /**
   * Smart+の配信中広告を取得
   */
  private async getActiveSmartPlusAds(
    advertiserId: string,
    accessToken: string,
    appeal: any,
  ): Promise<V2SmartPlusAd[]> {
    const response = await this.tiktokService.getSmartPlusAds(advertiserId, accessToken);
    const rawAds = response.data?.list || [];
    const activeAds = rawAds.filter((ad: any) => ad.operation_status === 'ENABLE');

    // Smart+ ad GETはad-levelにbudgetを持たないため、adgroup/campaignから予算を取得
    const adgroupIds = [...new Set(activeAds.map((ad: any) => ad.adgroup_id).filter(Boolean))];
    const campaignIds = [...new Set(activeAds.map((ad: any) => ad.campaign_id).filter(Boolean))];

    // AdGroup予算をバッチ取得
    const adgroupBudgetMap = new Map<string, number>();
    if (adgroupIds.length > 0) {
      try {
        const adgroupResponse = await this.tiktokService.getAdGroups(advertiserId, accessToken, campaignIds as string[]);
        const adgroups = adgroupResponse.data?.list || [];
        for (const ag of adgroups) {
          if (ag.adgroup_id && ag.budget) {
            adgroupBudgetMap.set(ag.adgroup_id, parseFloat(ag.budget));
          }
        }
        this.logger.log(`[V2] Fetched adgroup budgets: ${adgroupBudgetMap.size} adgroups with budget`);
      } catch (error) {
        this.logger.error(`[V2] Failed to fetch adgroup budgets: ${error.message}`);
      }
    }

    // CBO広告用: campaign予算をバッチ取得
    const campaignBudgetMap = new Map<string, number>();
    const cboAds = activeAds.filter((ad: any) => ad.budget_optimize_on === true || ad.budget_optimize_on === 'ON');
    const cboCampaignIds = [...new Set(cboAds.map((ad: any) => ad.campaign_id).filter(Boolean))] as string[];
    if (cboCampaignIds.length > 0) {
      for (const campaignId of cboCampaignIds) {
        try {
          const campaign = await this.tiktokService.getCampaign(advertiserId, accessToken, campaignId);
          if (campaign && campaign.budget) {
            campaignBudgetMap.set(campaignId, parseFloat(campaign.budget));
          }
        } catch (error) {
          this.logger.error(`[V2] Failed to fetch campaign budget for ${campaignId}: ${error.message}`);
        }
      }
      this.logger.log(`[V2] Fetched campaign budgets: ${campaignBudgetMap.size} campaigns with budget`);
    }

    return activeAds.map((ad: any) => {
      const adName = ad.ad_name || '';
      const validation = validateAdNameFormat(adName);
      const isCBO = ad.budget_optimize_on === true || ad.budget_optimize_on === 'ON';

      // 予算取得: CBO → campaign予算、非CBO → adgroup予算
      let dailyBudget = 0;
      if (isCBO) {
        dailyBudget = campaignBudgetMap.get(ad.campaign_id) || 0;
      } else {
        dailyBudget = adgroupBudgetMap.get(ad.adgroup_id) || 0;
      }

      if (dailyBudget === 0) {
        this.logger.warn(`[V2] Budget is 0 for ad ${ad.smart_plus_ad_id || ad.ad_id} (${adName}), isCBO=${isCBO}`);
      }

      return {
        adId: ad.smart_plus_ad_id || ad.ad_id,
        adName,
        adgroupId: ad.adgroup_id || '',
        campaignId: ad.campaign_id || '',
        advertiserId,
        status: ad.operation_status,
        dailyBudget,
        isCBO,
        parsedName: validation.isValid ? validation.parsed! : null,
      };
    });
  }

  /**
   * TikTok APIから当日メトリクスを取得
   */
  private async getTodayMetrics(
    advertiserId: string,
    accessToken: string,
    todayStr: string,
  ): Promise<Map<string, TodayMetrics>> {
    const metricsMap = new Map<string, TodayMetrics>();

    // 通常レポートAPI（AUCTION_AD）
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
          adId,
          spend: parseFloat(row.metrics?.spend || '0'),
          impressions: parseInt(row.metrics?.impressions || '0', 10),
          clicks: parseInt(row.metrics?.clicks || '0', 10),
          conversions: parseInt(row.metrics?.conversion || '0', 10),
        });
      }
    }

    // Smart+メトリクス
    const smartPlusMetrics = await this.tiktokService.getSmartPlusAdMetrics(
      advertiserId,
      accessToken,
      { startDate: todayStr, endDate: todayStr },
    );

    const smartPlusData = smartPlusMetrics.data?.list || [];
    for (const row of smartPlusData) {
      const smartPlusAdId = row.dimensions?.smart_plus_ad_id;
      if (!smartPlusAdId) continue;

      const spend = parseFloat(row.metrics?.spend || '0');
      const impressions = parseInt(row.metrics?.impressions || '0', 10);
      const clicks = parseInt(row.metrics?.clicks || '0', 10);
      const conversions = parseInt(row.metrics?.conversion || '0', 10);

      const existing = metricsMap.get(smartPlusAdId);
      if (existing) {
        existing.spend += spend;
        existing.impressions += impressions;
        existing.clicks += clicks;
        existing.conversions += conversions;
      } else {
        metricsMap.set(smartPlusAdId, { adId: smartPlusAdId, spend, impressions, clicks, conversions });
      }
    }

    return metricsMap;
  }

  /**
   * TikTok APIから過去7日間メトリクスを取得
   */
  private async getLast7DaysMetrics(
    advertiserId: string,
    accessToken: string,
    startStr: string,
    endStr: string,
  ): Promise<Map<string, Last7DaysMetrics>> {
    const metricsMap = new Map<string, Last7DaysMetrics>();

    // 通常レポートAPI
    const reportData = await this.tiktokService.getAllReportData(
      advertiserId,
      accessToken,
      {
        dataLevel: 'AUCTION_AD',
        startDate: startStr,
        endDate: endStr,
      },
    );

    for (const row of reportData) {
      const adId = row.dimensions?.ad_id;
      if (!adId) continue;
      const existing = metricsMap.get(adId);
      const spend = parseFloat(row.metrics?.spend || '0');
      const impressions = parseInt(row.metrics?.impressions || '0', 10);
      const conversions = parseInt(row.metrics?.conversion || '0', 10);

      if (existing) {
        existing.totalSpend += spend;
        existing.totalImpressions += impressions;
        existing.totalConversions += conversions;
      } else {
        metricsMap.set(adId, { adId, totalSpend: spend, totalImpressions: impressions, totalConversions: conversions });
      }
    }

    // Smart+メトリクス
    const smartPlusMetrics = await this.tiktokService.getSmartPlusAdMetrics(
      advertiserId,
      accessToken,
      { startDate: startStr, endDate: endStr },
    );

    const smartPlusData = smartPlusMetrics.data?.list || [];
    for (const row of smartPlusData) {
      const smartPlusAdId = row.dimensions?.smart_plus_ad_id;
      if (!smartPlusAdId) continue;

      const spend = parseFloat(row.metrics?.spend || '0');
      const impressions = parseInt(row.metrics?.impressions || '0', 10);
      const conversions = parseInt(row.metrics?.conversion || '0', 10);

      const existing = metricsMap.get(smartPlusAdId);
      if (existing) {
        existing.totalSpend += spend;
        existing.totalImpressions += impressions;
        existing.totalConversions += conversions;
      } else {
        metricsMap.set(smartPlusAdId, { adId: smartPlusAdId, totalSpend: spend, totalImpressions: impressions, totalConversions: conversions });
      }
    }

    return metricsMap;
  }

  // ============================================================================
  // 実行系
  // ============================================================================

  /**
   * 予算更新を実行
   */
  private async executeBudgetUpdate(
    ad: V2SmartPlusAd,
    newBudget: number,
    advertiserId: string,
    accessToken: string,
  ): Promise<void> {
    const oldBudget = ad.dailyBudget;
    this.logger.log(
      `[V2] Updating budget for ad ${ad.adId}: ¥${oldBudget} → ¥${newBudget} (CBO: ${ad.isCBO})`,
    );

    try {
      if (ad.isCBO) {
        // CBO: キャンペーン単位で予算更新
        await this.tiktokService.updateSmartPlusCampaignBudget(
          advertiserId, accessToken, ad.campaignId, newBudget,
        );
      } else {
        // 非CBO: AdGroup単位で予算更新
        await this.tiktokService.updateSmartPlusAdGroupBudgets(
          advertiserId, accessToken,
          [{ adgroup_id: ad.adgroupId, budget: newBudget }],
        );
      }

      // ChangeLog記録
      await withDatabaseRetry(() =>
        this.prisma.changeLog.create({
          data: {
            entityType: ad.isCBO ? 'CAMPAIGN' : 'ADGROUP',
            entityId: ad.isCBO ? ad.campaignId : ad.adgroupId,
            action: 'UPDATE_BUDGET',
            source: 'BUDGET_OPTIMIZATION_V2',
            beforeData: { budget: oldBudget },
            afterData: { budget: newBudget },
            reason: `V2予算増額: ¥${oldBudget} → ¥${newBudget}`,
          },
        }),
      );
    } catch (error) {
      this.logger.error(`[V2] Budget update failed for ad ${ad.adId}:`, error.message);
      throw error;
    }
  }

  /**
   * 広告を停止
   */
  private async executeAdPause(
    ad: V2SmartPlusAd,
    reason: string,
    advertiserId: string,
    accessToken: string,
  ): Promise<void> {
    this.logger.log(`[V2] Pausing ad ${ad.adId} (${ad.adName}): ${reason}`);

    try {
      await this.tiktokService.updateAdStatus(
        advertiserId, accessToken, [ad.adId], 'DISABLE',
      );

      // ChangeLog記録
      await withDatabaseRetry(() =>
        this.prisma.changeLog.create({
          data: {
            entityType: 'AD',
            entityId: ad.adId,
            action: 'PAUSE',
            source: 'BUDGET_OPTIMIZATION_V2',
            reason: `V2停止判定: ${reason}`,
          },
        }),
      );
    } catch (error) {
      this.logger.error(`[V2] Pause failed for ad ${ad.adId}:`, error.message);
      throw error;
    }
  }

  /**
   * 広告の日予算を20%ダウンする（個別予約CPO超過時）
   */
  private async executeBudgetDecrease(
    ad: V2SmartPlusAd,
    reason: string,
    advertiserId: string,
    accessToken: string,
  ): Promise<number> {
    const oldBudget = ad.dailyBudget;
    const newBudget = Math.max(
      TIKTOK_BUDGET_LIMITS.MIN,
      Math.floor(oldBudget * BUDGET_DECREASE_RATE),
    );

    this.logger.log(
      `[V2] Budget decrease for ad ${ad.adId} (${ad.adName}): ¥${oldBudget} → ¥${newBudget} (20% down, 個別予約CPO超過)`,
    );

    try {
      if (ad.isCBO) {
        await this.tiktokService.updateSmartPlusCampaignBudget(
          advertiserId, accessToken, ad.campaignId, newBudget,
        );
      } else {
        await this.tiktokService.updateSmartPlusAdGroupBudgets(
          advertiserId, accessToken,
          [{ adgroup_id: ad.adgroupId, budget: newBudget }],
        );
      }

      // ChangeLog記録
      await withDatabaseRetry(() =>
        this.prisma.changeLog.create({
          data: {
            entityType: ad.isCBO ? 'CAMPAIGN' : 'ADGROUP',
            entityId: ad.isCBO ? ad.campaignId : ad.adgroupId,
            action: 'DECREASE_BUDGET',
            source: 'BUDGET_OPTIMIZATION_V2',
            beforeData: { budget: oldBudget },
            afterData: { budget: newBudget },
            reason: `V2予算減額(個別予約CPO超過): ${reason}`,
          },
        }),
      );

      return newBudget;
    } catch (error) {
      this.logger.error(`[V2] Budget decrease failed for ad ${ad.adId}:`, error.message);
      throw error;
    }
  }

  // ============================================================================
  // Snapshot管理
  // ============================================================================

  private async saveSnapshots(
    advertiserId: string,
    ads: V2SmartPlusAd[],
    stage1Results: BudgetIncreaseDecision[],
    executionTime: Date,
  ): Promise<void> {
    const resultMap = new Map(stage1Results.map(r => [r.adId, r]));

    const snapshots = ads.map(ad => {
      const result = resultMap.get(ad.adId);
      return {
        advertiserId,
        adId: ad.adId,
        adName: ad.adName,
        executionTime,
        todayCVCount: result?.todayCV || 0,
        todaySpend: result?.todaySpend || 0,
        todayCPA: result?.todayCPA || null,
        dailyBudget: ad.dailyBudget,
        action: result?.action || 'SKIP',
        reason: result?.reason || null,
        newBudget: result?.newBudget || null,
      };
    });

    await withDatabaseRetry(() =>
      this.prisma.hourlyOptimizationSnapshot.createMany({ data: snapshots }),
    );
  }

  private async getLastSnapshots(
    advertiserId: string,
    todayStr: string,
  ): Promise<Map<string, { todayCVCount: number }>> {
    const todayStart = this.parseJSTDate(todayStr);
    const snapshots = await this.prisma.hourlyOptimizationSnapshot.findMany({
      where: {
        advertiserId,
        executionTime: { gte: todayStart },
      },
      orderBy: { executionTime: 'desc' },
      distinct: ['adId'],
    });

    return new Map(snapshots.map(s => [s.adId, { todayCVCount: s.todayCVCount }]));
  }

  private async cleanupOldSnapshots(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - SNAPSHOT_RETENTION_DAYS);

    try {
      const { count } = await this.prisma.hourlyOptimizationSnapshot.deleteMany({
        where: { createdAt: { lt: cutoffDate } },
      });
      if (count > 0) {
        this.logger.log(`[V2] Cleaned up ${count} old snapshots (before ${cutoffDate.toISOString()})`);
      }
    } catch (error) {
      this.logger.warn(`[V2] Snapshot cleanup failed: ${error.message}`);
    }
  }

  /**
   * スナップショット一覧取得（APIエンドポイント用）
   */
  async getSnapshots(advertiserId: string, date?: string) {
    const where: any = { advertiserId };
    if (date) {
      const start = this.parseJSTDate(date);
      const end = this.parseJSTDateEnd(date);
      where.executionTime = { gte: start, lte: end };
    }
    return this.prisma.hourlyOptimizationSnapshot.findMany({
      where,
      orderBy: { executionTime: 'desc' },
      take: 1000,
    });
  }

  // ============================================================================
  // ユーティリティ
  // ============================================================================

  private async isFirstRoundToday(advertiserId: string, todayStr: string): Promise<boolean> {
    const todayStart = this.parseJSTDate(todayStr);
    const count = await this.prisma.hourlyOptimizationSnapshot.count({
      where: {
        advertiserId,
        executionTime: { gte: todayStart },
      },
    });
    return count === 0;
  }

  private async getTargetAdvertiserIds(): Promise<string[]> {
    const advertisers = await this.prisma.advertiser.findMany({
      where: { appeal: { isNot: null } },
      select: { tiktokAdvertiserId: true },
    });
    return advertisers.map(a => a.tiktokAdvertiserId);
  }

  private async getEffectiveBudgetCap(adId: string, advertiserId: string): Promise<number | null> {
    try {
      const ad = await this.prisma.ad.findUnique({ where: { tiktokId: adId } });
      if (!ad) return null;
      const cap = await this.prisma.adBudgetCap.findUnique({
        where: { adId: ad.id, enabled: true },
      });
      return cap ? cap.maxDailyBudget : null;
    } catch {
      return null;
    }
  }

  private generateRegistrationPath(lpName: string, appealName: string): string {
    return `TikTok広告-${appealName}-${lpName}`;
  }

  private generateIndividualReservationPath(lpName: string, creativeName: string, appealName: string): string {
    return `TikTok広告-${appealName}-${lpName}`;
  }

  private getJSTHour(date: Date): number {
    const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return jst.getUTCHours();
  }

  private getJSTDateString(date: Date): string {
    const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().slice(0, 10);
  }

  private parseJSTDate(dateStr: string): Date {
    // dateStr: "YYYY-MM-DD" → JSTの00:00:00 = UTC前日15:00:00
    return new Date(`${dateStr}T00:00:00+09:00`);
  }

  private parseJSTDateEnd(dateStr: string): Date {
    // dateStr: "YYYY-MM-DD" → JSTの23:59:59
    return new Date(`${dateStr}T23:59:59+09:00`);
  }

  /**
   * 出稿日が直近7日以内かどうかを判定
   * @param adDateStr 広告名の日付部分 (YYMMDD形式, e.g., "260204")
   * @param todayStr 今日の日付 (YYYY-MM-DD形式, e.g., "2026-02-26")
   * @returns 出稿日が今日から7日以内ならtrue
   */
  private isWithin7DaysOfPublish(adDateStr: string, todayStr: string): boolean {
    try {
      if (!adDateStr || adDateStr.length < 6) return false;
      const year = 2000 + parseInt(adDateStr.slice(0, 2), 10);
      const month = parseInt(adDateStr.slice(2, 4), 10);
      const day = parseInt(adDateStr.slice(4, 6), 10);
      if (isNaN(year) || isNaN(month) || isNaN(day)) return false;

      const publishDate = new Date(Date.UTC(year, month - 1, day));
      const today = new Date(Date.UTC(
        parseInt(todayStr.slice(0, 4), 10),
        parseInt(todayStr.slice(5, 7), 10) - 1,
        parseInt(todayStr.slice(8, 10), 10),
      ));

      const diffMs = today.getTime() - publishDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays < 7;
    } catch {
      return false;
    }
  }

  private calculateLast7DaysPeriod(todayStr: string): {
    startDate: Date;
    endDate: Date;
    startStr: string;
    endStr: string;
  } {
    const today = new Date(`${todayStr}T00:00:00+09:00`);
    const start = new Date(today);
    start.setDate(start.getDate() - 6); // 当日含む7日間
    const startStr = start.toISOString().slice(0, 10);
    return {
      startDate: start,
      endDate: this.parseJSTDateEnd(todayStr),
      startStr,
      endStr: todayStr,
    };
  }

  private skipDecision(ad: V2SmartPlusAd, reason: string, todayCV: number = 0, todaySpend: number = 0): BudgetIncreaseDecision {
    return {
      adId: ad.adId,
      adName: ad.adName,
      action: 'SKIP',
      reason,
      currentBudget: ad.dailyBudget,
      todayCPA: todayCV > 0 ? todaySpend / todayCV : null,
      todayCV,
      todaySpend,
    };
  }

  // ============================================================================
  // 勝ちCR判定（0時リセットスキップ用）
  // ============================================================================

  /**
   * 勝ちCRのadIdセットを返す
   *
   * 条件:
   * - 直近30日間で1日7CV以上（スプレッドシート基準）を記録した日が1日以上ある
   * - SNS/AI: 7日間フロント販売 ≥ 1 AND 7日間フロントCPO ≤ targetFrontCPO
   * - セミナー: 7日間CV ≥ 1 AND 7日間CPA ≤ targetCPA
   */
  private async getWinningCRAdIds(
    ads: V2SmartPlusAd[],
    appeal: any,
    advertiserId: string,
    accessToken: string,
  ): Promise<Set<string>> {
    const winningAdIds = new Set<string>();
    const now = new Date();
    const todayStr = this.getJSTDateString(now);
    const channelType = detectChannelType(appeal.name);

    // 7日間メトリクス取得
    const { startDate: start7, endDate: end7, startStr, endStr } =
      this.calculateLast7DaysPeriod(todayStr);
    const last7DaysMetrics = await this.getLast7DaysMetrics(
      advertiserId, accessToken, startStr, endStr,
    );

    // 30日前の日付を計算
    const start30 = new Date(`${todayStr}T00:00:00+09:00`);
    start30.setDate(start30.getDate() - 29); // 当日含む30日間
    const end30 = this.parseJSTDateEnd(todayStr);

    for (const ad of ads) {
      try {
        if (!ad.parsedName) continue;

        const registrationPath = this.generateRegistrationPath(
          ad.parsedName.lpName, appeal.name,
        );

        // 条件1: 直近30日で1日7CV以上の日があるか
        const maxDailyCV = await this.googleSheetsService.getMaxDailyCVCount(
          appeal.cvSpreadsheetUrl,
          registrationPath,
          start30,
          end30,
        );
        if (maxDailyCV < 7) continue;

        // 7日間の広告費を取得
        const metrics = last7DaysMetrics.get(ad.adId);
        const spend = metrics?.totalSpend || 0;
        if (spend === 0) continue;

        if (usesFrontCPO(channelType)) {
          // 条件2 (SNS/AI): 7日間フロントCPO ≤ targetFrontCPO
          if (!appeal.targetFrontCPO || !appeal.frontSpreadsheetUrl) continue;

          const frontSalesCount = await this.googleSheetsService.getFrontSalesCount(
            appeal.name, appeal.frontSpreadsheetUrl, registrationPath,
            start7, end7,
          );
          if (frontSalesCount < 1) continue;

          const frontCPO = spend / frontSalesCount;
          if (frontCPO <= appeal.targetFrontCPO) {
            winningAdIds.add(ad.adId);
            this.logger.log(
              `[V2-RESET] Winning CR: ${ad.adName} (フロントCPO ¥${frontCPO.toFixed(0)} ≤ 目標 ¥${appeal.targetFrontCPO}, 最大日別CV=${maxDailyCV})`,
            );
          }
        } else {
          // 条件2 (セミナー): 7日間CPA ≤ targetCPA
          if (!appeal.targetCPA) continue;

          const cvCount = await this.googleSheetsService.getCVCount(
            appeal.name, appeal.cvSpreadsheetUrl, registrationPath,
            start7, end7,
          );
          if (cvCount < 1) continue;

          const cpa = spend / cvCount;
          if (cpa <= appeal.targetCPA) {
            winningAdIds.add(ad.adId);
            this.logger.log(
              `[V2-RESET] Winning CR: ${ad.adName} (CPA ¥${cpa.toFixed(0)} ≤ 目標 ¥${appeal.targetCPA}, 最大日別CV=${maxDailyCV})`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `[V2-RESET] Winning CR check failed for ${ad.adId}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `[V2-RESET] Found ${winningAdIds.size} winning CRs out of ${ads.length} active ads`,
    );
    return winningAdIds;
  }

  // ============================================================================
  // 日予算リセット（毎日0時）
  // ============================================================================

  /**
   * 特定AdvertiserのSmart+広告の日予算をデフォルトにリセット
   */
  async resetDailyBudgets(
    advertiserId: string,
    accessToken: string,
    dryRun: boolean = false,
  ): Promise<BudgetResetResult> {
    const now = new Date();
    this.logger.log(
      `[V2-RESET] Starting budget reset for ${advertiserId} (dryRun: ${dryRun})`,
    );

    // Advertiser & Appeal取得
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: advertiserId },
      include: { appeal: true },
    });

    if (!advertiser || !advertiser.appeal) {
      throw new Error(`Advertiser ${advertiserId} not found or no appeal assigned`);
    }

    const appeal = advertiser.appeal;
    const channelType = detectChannelType(appeal.name);
    const defaultBudget = DEFAULT_DAILY_BUDGET[channelType];

    this.logger.log(
      `[V2-RESET] Channel: ${channelType}, Default budget: ¥${defaultBudget}`,
    );

    // Smart+配信中広告を取得
    const activeAds = await this.getActiveSmartPlusAds(advertiserId, accessToken, appeal);
    this.logger.log(`[V2-RESET] Found ${activeAds.length} active Smart+ ads`);

    // 勝ちCR判定（リセットスキップ対象を特定）
    // Google Sheetsキャッシュクリア（0時実行なので新しいデータを取得）
    this.googleSheetsService.clearCache();
    const winningAdIds = await this.getWinningCRAdIds(
      activeAds, appeal, advertiserId, accessToken,
    );

    const adResults: BudgetResetAdResult[] = [];
    // 同一entity (campaign/adgroup) の重複リセットを防止
    const processedEntities = new Set<string>();
    // 勝ちCR判定済みentity（CBO時に同一campaign内の1つが勝ちCRなら全体スキップ）
    const winningEntities = new Set<string>();
    for (const ad of activeAds) {
      if (winningAdIds.has(ad.adId)) {
        const entityKey = ad.isCBO
          ? `CAMPAIGN:${ad.campaignId}`
          : `ADGROUP:${ad.adgroupId}`;
        winningEntities.add(entityKey);
      }
    }

    for (const ad of activeAds) {
      const entityType = ad.isCBO ? 'CAMPAIGN' : 'ADGROUP';
      const entityId = ad.isCBO ? ad.campaignId : ad.adgroupId;
      const entityKey = `${entityType}:${entityId}`;

      // 既に同じentityを処理済みならスキップ
      if (processedEntities.has(entityKey)) {
        continue;
      }
      processedEntities.add(entityKey);

      // 勝ちCRはリセットスキップ（予算を維持）
      if (winningEntities.has(entityKey)) {
        adResults.push({
          adId: ad.adId,
          adName: ad.adName,
          action: 'SKIP_WINNING_CR',
          entityType,
          entityId,
          oldBudget: ad.dailyBudget,
          newBudget: ad.dailyBudget,
        });
        this.logger.log(
          `[V2-RESET] SKIP_WINNING_CR ${ad.adName}: 勝ちCRのため予算維持 ¥${ad.dailyBudget}`,
        );
        continue;
      }

      // 既にデフォルト予算の場合はスキップ
      if (ad.dailyBudget === defaultBudget) {
        adResults.push({
          adId: ad.adId,
          adName: ad.adName,
          action: 'SKIP_ALREADY_DEFAULT',
          entityType,
          entityId,
          oldBudget: ad.dailyBudget,
          newBudget: defaultBudget,
        });
        this.logger.log(
          `[V2-RESET] SKIP ${ad.adName}: already at default ¥${defaultBudget}`,
        );
        continue;
      }

      // リセット実行
      try {
        if (!dryRun) {
          if (ad.isCBO) {
            await this.tiktokService.updateSmartPlusCampaignBudget(
              advertiserId, accessToken, ad.campaignId, defaultBudget,
            );
          } else {
            await this.tiktokService.updateSmartPlusAdGroupBudgets(
              advertiserId, accessToken,
              [{ adgroup_id: ad.adgroupId, budget: defaultBudget }],
            );
          }

          // ChangeLog記録
          await withDatabaseRetry(() =>
            this.prisma.changeLog.create({
              data: {
                entityType,
                entityId,
                action: 'RESET_BUDGET',
                source: 'BUDGET_RESET_MIDNIGHT',
                beforeData: { budget: ad.dailyBudget },
                afterData: { budget: defaultBudget },
                reason: `日予算リセット: ¥${ad.dailyBudget} → ¥${defaultBudget} (${channelType}デフォルト)`,
              },
            }),
          );
        }

        adResults.push({
          adId: ad.adId,
          adName: ad.adName,
          action: 'RESET',
          entityType,
          entityId,
          oldBudget: ad.dailyBudget,
          newBudget: defaultBudget,
        });
        this.logger.log(
          `[V2-RESET] ${dryRun ? '[DRY-RUN] ' : ''}RESET ${ad.adName}: ¥${ad.dailyBudget} → ¥${defaultBudget}`,
        );
      } catch (error) {
        adResults.push({
          adId: ad.adId,
          adName: ad.adName,
          action: 'ERROR',
          entityType,
          entityId,
          oldBudget: ad.dailyBudget,
          newBudget: defaultBudget,
          error: error.message,
        });
        this.logger.error(
          `[V2-RESET] ERROR resetting ${ad.adName}: ${error.message}`,
        );
      }
    }

    const summary = {
      totalAds: adResults.length,
      reset: adResults.filter(r => r.action === 'RESET').length,
      skippedAlreadyDefault: adResults.filter(r => r.action === 'SKIP_ALREADY_DEFAULT').length,
      skippedWinningCR: adResults.filter(r => r.action === 'SKIP_WINNING_CR').length,
      errors: adResults.filter(r => r.action === 'ERROR').length,
    };

    this.logger.log(
      `[V2-RESET] Done for ${advertiserId}: total=${summary.totalAds}, reset=${summary.reset}, skipDefault=${summary.skippedAlreadyDefault}, skipWinning=${summary.skippedWinningCR}, errors=${summary.errors}`,
    );

    return {
      advertiserId,
      channelType,
      defaultBudget,
      executionTime: now.toISOString(),
      dryRun,
      adResults,
      summary,
    };
  }

  /**
   * 全対象アカウントの日予算をリセット
   */
  async resetAllDailyBudgets(accessToken: string, dryRun: boolean = false) {
    const jobName = 'budget-reset-midnight';
    if (!batchJobLock.acquire(jobName, 600000)) {
      this.logger.warn('[V2-RESET] Previous reset job is still running. Skipping...');
      return { success: false, reason: 'JOB_LOCKED' };
    }

    try {
      const advertiserIds = await this.getTargetAdvertiserIds();
      const results: BudgetResetResult[] = [];

      for (const advertiserId of advertiserIds) {
        try {
          const result = await this.resetDailyBudgets(advertiserId, accessToken, dryRun);
          results.push(result);
        } catch (error) {
          this.logger.error(`[V2-RESET] Failed for advertiser ${advertiserId}:`, error);
        }
      }

      return { success: true, dryRun, results };
    } finally {
      batchJobLock.release(jobName);
    }
  }

  // ============================================================================
  // ヘルパー
  // ============================================================================

  private emptyResult(advertiserId: string, now: Date): HourlyExecutionResult {
    return {
      advertiserId,
      executionTime: now.toISOString(),
      isFirstRound: false,
      stage1Results: [],
      stage2Results: [],
      summary: { totalAds: 0, increased: 0, continued: 0, paused: 0, skipped: 0, budgetDecreased: 0 },
    };
  }
}
