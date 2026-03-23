// ============================================================================
// 利益最大化シミュレーション - ドメイン型定義
// ============================================================================

/** 導線タイプ */
export type ChannelType = 'AI' | 'SNS' | 'SKILL_PLUS';

// ============================================================================
// ファネルモデル
// ============================================================================

/** ファネルの各ステージ */
export interface FunnelStage {
  name: string;
  count: number;
  revenue?: number;
}

/** 導線別ファネルモデル */
export interface FunnelModel {
  channelType: ChannelType;
  stages: FunnelStage[];
  adSpend: number;
  totalRevenue: number;
}

/** ステージ間の転換率 */
export interface ConversionRate {
  fromStage: string;
  toStage: string;
  rate: number; // 0.0 ~ 1.0+（フロント→個別率は100%超もありうる）
}

// ============================================================================
// 利益シミュレーション
// ============================================================================

export interface ProfitSimulation {
  channelType: ChannelType;
  period: { year: number; month: number };

  // 実績（当月1日〜本日）
  actualDays: number;
  actualAdSpend: number;
  actualRevenue: number;
  actualProfit: number;

  // 推定（月末着地）
  totalDaysInMonth: number;
  projectedAdSpend: number;
  projectedRevenue: number;
  projectedProfit: number;

  // 目標との比較
  targetProfit: number;
  gapToTarget: number;
  isOnTrack: boolean;
}

/** 全導線サマリー */
export interface TotalProfitSummary {
  period: { year: number; month: number };
  channels: ProfitSimulation[];
  totalActualProfit: number;
  totalProjectedProfit: number;
  totalTargetProfit: number;
  totalGapToTarget: number;
  isOnTrack: boolean;
}

// ============================================================================
// 改善方向の判定
// ============================================================================

export type ImprovementDirection =
  | 'ON_TRACK'
  | 'IMPROVE_ROAS'
  | 'INCREASE_ACQUISITION'
  | 'BOTH';

export interface DirectionJudgment {
  direction: ImprovementDirection;
  reason: string;
  currentROAS: number;
  targetROAS: number;
  currentAcquisition: number;
  requiredAcquisition: number;
}

// ============================================================================
// ボトルネック特定
// ============================================================================

export interface BottleneckResult {
  stage: string;
  currentRate: number;
  targetRate: number;
  gapPoints: number;
  profitImpact: number;
  rank: number;
}

// ============================================================================
// TODO生成
// ============================================================================

export type TodoActionType =
  | 'CROSS_DEPLOY'
  | 'REDEPLOY'
  | 'PAUSE_AD'
  | 'BUDGET_CHANGE'
  | 'CREATIVE_REQUEST'
  | 'LP_IMPROVEMENT'
  | 'FUNNEL_FIX'
  | 'TARGETING_CHANGE'
  | 'INVESTIGATION';

export interface GeneratedTodo {
  id: string;
  channelType: ChannelType;
  period: string; // 'YYYY-MM'
  bottleneckStage: string;
  currentRate: number;
  targetRate: number;
  gapPoints: number;
  profitImpact: number;
  action: string;
  actionType: TodoActionType;
  isAutoExecutable: boolean;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
}

export type FeedbackDecision = 'APPROVED' | 'REJECTED' | 'MODIFIED';

export interface TodoFeedback {
  id: string;
  todoId: string;
  decision: FeedbackDecision;
  reason: string;
  rule?: string;
  timestamp: Date;
}

// ============================================================================
// ルール
// ============================================================================

export interface OpsRule {
  id: string;
  category: string;
  rule: string;
  condition?: string;
  action?: string;
}

// ============================================================================
// 勝ちCR
// ============================================================================

export interface WinningCreative {
  adId: string;
  adName: string;
  advertiserId: string;
  channelType: ChannelType;
}

// ============================================================================
// データ取得用型
// ============================================================================

export interface DailyMetrics {
  date: string; // 'YYYY/M/D'
  impressions: number;
  clicks: number;
  optins: number;
  adSpend: number;
  revenue: number;
  cpc: number;
  /** ステージ別実績（ステージ名 → 件数） */
  stageValues: Record<string, number>;
}

/** MetricsDataSourceが返すデータ */
export interface MonthlyMetricsData {
  channelType: ChannelType;
  year: number;
  month: number;
  adSpend: number;
  totalRevenue: number;
  optinCount: number;
  clickCount: number;
  impressions: number;
  optinLTV: number;
  stageMetrics: Record<string, number>;
  dailyData: DailyMetrics[];
}

/** KPI目標値 */
export interface KPITargets {
  /** KPI項目名 → 許容値（比率または金額） */
  conversionRates: Record<string, number>;
  targetROAS: number;
  avgPaymentAmount: number;
  cpa: number;
}

// ============================================================================
// ファネルステージ定義（導線ごとの固定定義）
// ============================================================================

/** AI/SNS導線のファネルステージ名 */
export const AI_SNS_STAGES = [
  'インプレッション',
  'クリック',
  'オプトイン',
  'フロント購入',
  '秘密の部屋購入',
  'LINE登録',
  '個別予約',
  '個別着座',
  'バックエンド購入',
] as const;

/** スキルプラス導線のファネルステージ名 */
export const SKILL_PLUS_STAGES = [
  'インプレッション',
  'クリック',
  'オプトイン',
  'LINE登録',
  'セミナー予約',
  'セミナー着座',
  '個別予約',
  '個別着座',
  'バックエンド購入',
] as const;

/** KPI項目名 → ファネルステージ間マッピング（AI/SNS） */
export const AI_SNS_KPI_STAGE_MAP: Record<string, [string, string]> = {
  'オプト→フロント率': ['オプトイン', 'フロント購入'],
  'フロント→個別率': ['フロント購入', '個別予約'],
  '個別→着座率': ['個別予約', '個別着座'],
  '着座→成約率': ['個別着座', 'バックエンド購入'],
};

/** KPI項目名 → ファネルステージ間マッピング（スキルプラス） */
export const SKILL_PLUS_KPI_STAGE_MAP: Record<string, [string, string]> = {
  'オプト→メイン': ['オプトイン', 'LINE登録'],
  'メイン→企画': ['LINE登録', 'セミナー予約'],
  '企画→セミナー予約率': ['セミナー予約', 'セミナー予約'], // 内部ステップ（通常100%）
  'セミナー予約→セミナー着座率': ['セミナー予約', 'セミナー着座'],
  'セミナー着座→個別予約率': ['セミナー着座', '個別予約'],
  '個別予約→個別着座率': ['個別予約', '個別着座'],
  '個別着座→成約率': ['個別着座', 'バックエンド購入'],
};
