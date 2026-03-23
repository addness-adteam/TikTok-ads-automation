// ============================================================================
// 利益最大化シミュレーション - ポート定義（ドメインが定義するインターフェース）
// インフラ層がこれらを実装し、NestJS DIでバインドする
// ============================================================================

import {
  ChannelType,
  MonthlyMetricsData,
  KPITargets,
  GeneratedTodo,
  TodoFeedback,
  OpsRule,
  WinningCreative,
  TotalProfitSummary,
  BottleneckResult,
} from './types';

// ============================================================================
// データ取得ポート
// ============================================================================

/** スプシから月次実績・KPIを取得 */
export interface MetricsDataSource {
  getMonthlyMetrics(
    channelType: ChannelType,
    year: number,
    month: number,
  ): Promise<MonthlyMetricsData>;

  getKPI(
    channelType: ChannelType,
    year: number,
    month: number,
  ): Promise<KPITargets>;

  getTargetProfit(
    channelType: ChannelType,
    year: number,
    month: number,
  ): Promise<number>;
}

// ============================================================================
// TODO永続化ポート
// ============================================================================

export interface TodoRepository {
  save(todo: GeneratedTodo): Promise<void>;
  saveBatch(todos: GeneratedTodo[]): Promise<void>;
  findByPeriod(
    channelType: ChannelType,
    period: string,
  ): Promise<GeneratedTodo[]>;
  updateStatus(id: string, status: GeneratedTodo['status']): Promise<void>;
}

// ============================================================================
// フィードバック永続化ポート
// ============================================================================

export interface FeedbackRepository {
  save(feedback: TodoFeedback): Promise<void>;
  findByTodoId(todoId: string): Promise<TodoFeedback[]>;
}

// ============================================================================
// ルール読み書きポート（TodoGenerationが使用）
// ============================================================================

/** daily-ops-rules.mdの読み書き */
export interface RuleStore {
  loadRules(): Promise<OpsRule[]>;
  addRule(rule: OpsRule): Promise<void>;
}

// ============================================================================
// 勝ちCR情報ポート（TodoGenerationが使用）
// ============================================================================

/** 横展開・再出稿候補となる勝ちCRの存在確認 */
export interface WinningCreativeSource {
  hasWinningCreatives(channelType: ChannelType): Promise<boolean>;
  getWinningCreatives(channelType: ChannelType): Promise<WinningCreative[]>;
}

// ============================================================================
// 結果出力ポート
// ============================================================================

/** シミュレーション結果のMDファイル出力 */
export interface ReportOutput {
  writeReport(
    summary: TotalProfitSummary,
    bottlenecks: BottleneckResult[],
    todos: GeneratedTodo[],
  ): Promise<void>;
}

// ============================================================================
// DIトークン（NestJSのカスタムプロバイダー用）
// ============================================================================

export const METRICS_DATA_SOURCE = Symbol('MetricsDataSource');
export const TODO_REPOSITORY = Symbol('TodoRepository');
export const FEEDBACK_REPOSITORY = Symbol('FeedbackRepository');
export const RULE_STORE = Symbol('RuleStore');
export const WINNING_CREATIVE_SOURCE = Symbol('WinningCreativeSource');
export const REPORT_OUTPUT = Symbol('ReportOutput');
