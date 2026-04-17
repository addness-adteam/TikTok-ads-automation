// ============================================================================
// 予算調整V2 型定義・定数
// ============================================================================

/** 増額倍率 */
export const BUDGET_INCREASE_RATE = 1.3;

/** セミナー導線: この予算を超えたら1.3倍ではなく+1万円刻みに切替 */
export const SEMINAR_LINEAR_INCREASE_THRESHOLD = 70_000;
export const SEMINAR_LINEAR_INCREASE_AMOUNT = 10_000;

/** 予算帯の閾値（円） */
export const BUDGET_TIER = {
  LOW_MAX: 8_000,
  MID_MAX: 20_000,
  HIGH_MAX: 40_000,
} as const;

/** 予算帯ごとの増額に必要な最低オプト数 */
export const BUDGET_TIER_MIN_OPTS = {
  LOW: 1, // 8,000円未満: CV1以上で増額
  MID: 2, // 8,000〜20,000円: オプト2以上で増額
  HIGH: 3, // 20,000〜40,000円: オプト3以上で増額
} as const;

/**
 * 勝ちCR向け拡張予算帯（¥40,000超、上限なし）
 * 勝ちCR = SNS/AI: 7日間フロントCPO ≤ 目標フロントCPO
 *          セミナー: 7日間CPA ≤ 目標CPA
 */
export const WINNING_CR_BUDGET_TIER = {
  TIER1_MAX: 80_000, // 40,000〜80,000円
  TIER2_MAX: 150_000, // 80,000〜150,000円
  TIER3_MAX: 300_000, // 150,000〜300,000円（グローバル上限）
} as const;

export const WINNING_CR_BUDGET_TIER_MIN_OPTS = {
  TIER1: 4, // 40,000〜80,000円: 4CV以上
  TIER2: 5, // 80,000〜150,000円: 5CV以上
  TIER3: 6, // 150,000円超: 6CV以上
} as const;

/** 運用時間帯（JST） */
export const OPERATION_HOURS = {
  FIRST_ROUND_HOUR: 0, // 00:30 JST（GitHub Actionsの0:30実行で第1回）
  LAST_HOUR: 23, // 23:30 JST（24時間予算増加対応）
} as const;

/** 新規CR保護: 停止判定に必要な最低インプレッション */
export const MIN_IMPRESSIONS_FOR_PAUSE = 5_000;

/** Snapshotデータ保持日数 */
export const SNAPSHOT_RETENTION_DAYS = 7;

/** TikTok APIの予算制限（円） */
export const TIKTOK_BUDGET_LIMITS = {
  MIN: 2_000,
  MAX: 50_000_000,
} as const;

/** 予算減額率（個別予約CPO超過時） */
export const BUDGET_DECREASE_RATE = 0.8;

/** チャネル別デフォルト日予算（円） */
export const DEFAULT_DAILY_BUDGET: Record<ChannelType, number> = {
  AI: 3_000,
  SEMINAR: 5_000,
  SNS: 3_000,
} as const;

/** 日次レポート書き出し先スプレッドシートID */
export const DAILY_REPORT_SPREADSHEET_ID =
  '17PWEALugoIY2aKtjpITuyEAwJRz7o03q5iLeR5_5FwM';

/** 日次レポートシート名 */
export const DAILY_REPORT_SHEET_NAME = 'シート1';

/** 個別予約スプレッドシートID（全導線共通） */
export const INDIVIDUAL_RESERVATION_SPREADSHEET_ID =
  '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

/** 個別予約 導線別タブ・列設定 */
export const INDIVIDUAL_RESERVATION_CONFIG = {
  SEMINAR: {
    sheetName: 'スキルプラス（オートウェビナー用）',
    dateColumnIndex: 0, // A列
    pathColumnIndex: 34, // AI列
  },
  AI: {
    sheetName: 'AI',
    dateColumnIndex: 0, // A列
    pathColumnIndex: 46, // AU列
  },
  SNS: {
    sheetName: 'SNS',
    dateColumnIndex: 0, // A列
    pathColumnIndex: 46, // AU列
  },
} as const;

// ----------------------------------------------------------------------------
// 導線タイプ
// ----------------------------------------------------------------------------

export type ChannelType = 'SNS' | 'AI' | 'SEMINAR';

/** Appeal名から導線タイプを判定 */
export function detectChannelType(appealName: string): ChannelType {
  const upper = appealName.toUpperCase();
  if (upper.includes('SNS')) return 'SNS';
  if (upper.includes('AI')) return 'AI';
  return 'SEMINAR';
}

/** フロントCPOで判定する導線か */
export function usesFrontCPO(channelType: ChannelType): boolean {
  return channelType === 'SNS' || channelType === 'AI';
}

// ----------------------------------------------------------------------------
// Smart+広告情報
// ----------------------------------------------------------------------------

export interface V2SmartPlusAd {
  adId: string;
  adName: string;
  adgroupId: string;
  campaignId: string;
  advertiserId: string;
  status: string;
  /** 日予算（円） */
  dailyBudget: number;
  /** CBO有効かどうか */
  isCBO: boolean;
  /** Smart+広告かどうか（falseなら通常広告） */
  isSmartPlus: boolean;
  /** 広告名からパースした情報 */
  parsedName: {
    date: string;
    creator: string;
    creativeName: string;
    lpName: string;
  } | null;
}

// ----------------------------------------------------------------------------
// 当日メトリクス
// ----------------------------------------------------------------------------

export interface TodayMetrics {
  adId: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

// ----------------------------------------------------------------------------
// 過去7日間メトリクス
// ----------------------------------------------------------------------------

export interface Last7DaysMetrics {
  adId: string;
  totalSpend: number;
  totalImpressions: number;
  totalConversions: number;
}

// ----------------------------------------------------------------------------
// 増額判定
// ----------------------------------------------------------------------------

export type BudgetAction = 'INCREASE' | 'CONTINUE' | 'SKIP';

export interface BudgetIncreaseDecision {
  adId: string;
  adName: string;
  action: BudgetAction;
  reason: string;
  currentBudget: number;
  newBudget?: number;
  todayCPA: number | null;
  todayCV: number;
  todaySpend: number;
}

// ----------------------------------------------------------------------------
// 停止判定
// ----------------------------------------------------------------------------

export type PauseAction =
  | 'PAUSE'
  | 'CONTINUE'
  | 'SKIP_NEW_CR'
  | 'BUDGET_DECREASE_20PCT';

export interface PauseDecision {
  adId: string;
  adName: string;
  action: PauseAction;
  reason: string;
  channelType: ChannelType;
  last7DaysSpend: number;
  last7DaysImpressions: number;
  last7DaysCVCount: number;
  last7DaysFrontSalesCount: number;
  last7DaysCPA: number | null;
  last7DaysFrontCPO: number | null;
  last7DaysIndividualReservationCount: number;
  last7DaysIndividualReservationCPO: number | null;
  newBudgetAfterDecrease?: number;
}

// ----------------------------------------------------------------------------
// 毎時実行結果
// ----------------------------------------------------------------------------

export interface HourlyExecutionResult {
  advertiserId: string;
  executionTime: string;
  isFirstRound: boolean;
  stage1Results: BudgetIncreaseDecision[];
  stage2Results: PauseDecision[];
  summary: {
    totalAds: number;
    increased: number;
    continued: number;
    paused: number;
    skipped: number;
    budgetDecreased: number;
  };
}

// ----------------------------------------------------------------------------
// 予算リセット
// ----------------------------------------------------------------------------

export type BudgetResetAction = 'RESET' | 'SKIP_ALREADY_DEFAULT' | 'ERROR';

export interface BudgetResetAdResult {
  adId: string;
  adName: string;
  action: BudgetResetAction;
  entityType: 'CAMPAIGN' | 'ADGROUP';
  entityId: string;
  oldBudget: number;
  newBudget: number;
  error?: string;
}

export interface BudgetResetResult {
  advertiserId: string;
  channelType: ChannelType;
  defaultBudget: number;
  executionTime: string;
  dryRun: boolean;
  adResults: BudgetResetAdResult[];
  summary: {
    totalAds: number;
    reset: number;
    skippedAlreadyDefault: number;
    errors: number;
  };
}
