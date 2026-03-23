// ============================================================================
// ProfitSimulationService - オーケストレーション
// Step 1〜10のフローを実行する
// ============================================================================

import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  METRICS_DATA_SOURCE,
  TODO_REPOSITORY,
  FEEDBACK_REPOSITORY,
  RULE_STORE,
  WINNING_CREATIVE_SOURCE,
  REPORT_OUTPUT,
} from './domain/ports';
import type {
  MetricsDataSource,
  TodoRepository,
  FeedbackRepository,
  RuleStore,
  WinningCreativeSource,
  ReportOutput,
} from './domain/ports';
import {
  ChannelType,
  TotalProfitSummary,
  ProfitSimulation,
  BottleneckResult,
  GeneratedTodo,
  TodoFeedback,
  FeedbackDecision,
} from './domain/types';
import { buildFunnelModel } from './domain/funnel-model';
import { calculateProfitSimulation, calculateTotalProfitSummary } from './domain/profit-simulation';
import { judgeDirection, calculateRequiredAcquisition } from './domain/direction-judgment';
import { detectBottlenecks } from './domain/bottleneck-detection';
import { generateTodos } from './domain/todo-generation';
import { v4 as uuidv4 } from 'uuid';

const ALL_CHANNELS: ChannelType[] = ['AI', 'SNS', 'SKILL_PLUS'];

@Injectable()
export class ProfitSimulationService {
  private readonly logger = new Logger(ProfitSimulationService.name);

  constructor(
    @Inject(METRICS_DATA_SOURCE) private readonly metricsDataSource: MetricsDataSource,
    @Inject(TODO_REPOSITORY) private readonly todoRepository: TodoRepository,
    @Inject(FEEDBACK_REPOSITORY) private readonly feedbackRepository: FeedbackRepository,
    @Inject(RULE_STORE) private readonly ruleStore: RuleStore,
    @Inject(WINNING_CREATIVE_SOURCE) private readonly winningCreativeSource: WinningCreativeSource,
    @Inject(REPORT_OUTPUT) private readonly reportOutput: ReportOutput,
  ) {}

  /**
   * 全導線のシミュレーション実行
   * Step 1〜7 + レポート出力
   */
  async run(channelFilter?: ChannelType): Promise<{
    summary: TotalProfitSummary;
    allBottlenecks: BottleneckResult[];
    allTodos: GeneratedTodo[];
  }> {
    const now = new Date();
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const year = jstNow.getFullYear();
    const month = jstNow.getMonth() + 1;
    const dayOfMonth = jstNow.getDate();
    const totalDaysInMonth = new Date(year, month, 0).getDate();
    const period = `${year}-${String(month).padStart(2, '0')}`;

    const channels = channelFilter ? [channelFilter] : ALL_CHANNELS;

    this.logger.log(`シミュレーション開始: ${period} (${channels.join(', ')})`);

    const channelResults: ProfitSimulation[] = [];
    const allBottlenecks: BottleneckResult[] = [];
    const allTodos: GeneratedTodo[] = [];

    for (const channelType of channels) {
      try {
        // Step 1: 現状数値取得
        this.logger.log(`[${channelType}] Step 1: 数値取得中...`);
        const metrics = await this.metricsDataSource.getMonthlyMetrics(channelType, year, month);
        const kpi = await this.metricsDataSource.getKPI(channelType, year, month);
        const targetProfit = await this.metricsDataSource.getTargetProfit(channelType, year, month);

        // Step 2: 月次利益シミュレーション
        this.logger.log(`[${channelType}] Step 2: シミュレーション...`);
        const actualDays = metrics.dailyData.filter(d => d.adSpend > 0 || d.optins > 0).length || dayOfMonth;
        const simulation = calculateProfitSimulation({
          channelType,
          year,
          month,
          actualDays,
          totalDaysInMonth,
          actualAdSpend: metrics.adSpend,
          actualRevenue: metrics.totalRevenue,
          targetProfit,
        });
        channelResults.push(simulation);

        // Step 3 & 4: 目標到達判定 + 改善方向
        this.logger.log(`[${channelType}] Step 3-4: 判定...`);
        const cpa = metrics.optinCount > 0 ? metrics.adSpend / metrics.optinCount : 0;
        const requiredAcquisition = calculateRequiredAcquisition(targetProfit, metrics.optinLTV, cpa);
        const targetROAS = metrics.adSpend > 0
          ? (targetProfit + simulation.projectedAdSpend) / simulation.projectedAdSpend
          : kpi.targetROAS;
        const currentROAS = metrics.adSpend > 0 ? metrics.totalRevenue / metrics.adSpend : 0;

        const judgment = judgeDirection({
          currentROAS,
          targetROAS,
          currentAcquisition: metrics.optinCount,
          requiredAcquisition,
        });
        this.logger.log(`[${channelType}] 判定結果: ${judgment.direction} - ${judgment.reason}`);

        // Step 5-6: ボトルネック特定
        this.logger.log(`[${channelType}] Step 5-6: ボトルネック特定...`);
        const bottlenecks = detectBottlenecks(channelType, metrics.stageMetrics, kpi);
        allBottlenecks.push(...bottlenecks);

        // Step 7: TODO生成
        this.logger.log(`[${channelType}] Step 7: TODO生成...`);
        const todos = await generateTodos(
          channelType, period, bottlenecks, judgment.direction,
          this.ruleStore, this.winningCreativeSource,
        );
        allTodos.push(...todos);
      } catch (error) {
        this.logger.error(`[${channelType}] エラー: ${error}`);
      }
    }

    // 全導線サマリー
    const summary = calculateTotalProfitSummary(channelResults, { year, month });

    // TODO永続化
    if (allTodos.length > 0) {
      await this.todoRepository.saveBatch(allTodos);
      this.logger.log(`TODO ${allTodos.length}件をDBに保存`);
    }

    // レポート出力
    await this.reportOutput.writeReport(summary, allBottlenecks, allTodos);

    this.logger.log(`シミュレーション完了: 粗利推定 ${summary.totalProjectedProfit.toLocaleString()}円`);

    return { summary, allBottlenecks, allTodos };
  }

  /** TODO承認 */
  async approveTodo(todoId: string): Promise<void> {
    await this.todoRepository.updateStatus(todoId, 'APPROVED');
    await this.feedbackRepository.save({
      id: uuidv4(),
      todoId,
      decision: 'APPROVED',
      reason: '承認',
      timestamp: new Date(),
    });
    this.logger.log(`TODO承認: ${todoId}`);
  }

  /** TODO却下（理由付き） */
  async rejectTodo(todoId: string, reason: string, rule?: string): Promise<void> {
    await this.todoRepository.updateStatus(todoId, 'REJECTED');
    await this.feedbackRepository.save({
      id: uuidv4(),
      todoId,
      decision: 'REJECTED',
      reason,
      rule,
      timestamp: new Date(),
    });

    // ルールが指定されていればdaily-ops-rules.mdに追加
    if (rule) {
      const ruleId = `R_PS_${Date.now()}`;
      await this.ruleStore.addRule({
        id: ruleId,
        category: '利益シミュレーション',
        rule,
      });
      this.logger.log(`ルール追加: ${ruleId} - ${rule}`);
    }

    this.logger.log(`TODO却下: ${todoId} - ${reason}`);
  }

  /** フィードバック記録 */
  async addFeedback(
    todoId: string,
    decision: FeedbackDecision,
    reason: string,
    rule?: string,
  ): Promise<void> {
    await this.feedbackRepository.save({
      id: uuidv4(),
      todoId,
      decision,
      reason,
      rule,
      timestamp: new Date(),
    });

    if (rule) {
      const ruleId = `R_PS_${Date.now()}`;
      await this.ruleStore.addRule({
        id: ruleId,
        category: '利益シミュレーション',
        rule,
      });
    }
  }
}
