// ============================================================================
// 予算調整V2 型定義・定数
// ============================================================================

/** 増額倍率 */
export const BUDGET_INCREASE_RATE = 1.3;

/** 予算帯の閾値（円） */
export const BUDGET_TIER = {
  LOW_MAX: 8_000,
  MID_MAX: 20_000,
  HIGH_MAX: 40_000,
} as const;

/** 予算帯ごとの増額に必要な最低オプト数 */
export const BUDGET_TIER_MIN_OPTS = {
  LOW: 1,    // 8,000円未満: CV1以上で増額
  MID: 2,    // 8,000〜20,000円: オプト2以上で増額
  HIGH: 3,   // 20,000〜40,000円: オプト3以上で増額
} as const;

/** 運用時間帯（JST） */
export const OPERATION_HOURS = {
  FIRST_ROUND_HOUR: 1,  // 01:00 JST
  LAST_HOUR: 19,         // 19:00 JST（20:00以降は実行しない）
} as const;

/** 新規CR保護: 停止判定に必要な最低インプレッション */
export const MIN_IMPRESSIONS_FOR_PAUSE = 5_000;

/** Snapshotデータ保持日数 */
export const SNAPSHOT_RETENTION_DAYS = 730;

/** TikTok APIの予算制限（円） */
export const TIKTOK_BUDGET_LIMITS = {
  MIN: 2_000,
  MAX: 50_000_000,
} as const;

/** 予算減額率（個別予約CPO超過時） */
export const BUDGET_DECREASE_RATE = 0.8;

/** 個別予約スプレッドシートID（全導線共通） */
export const INDIVIDUAL_RESERVATION_SPREADSHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

/** 個別予約 導線別タブ・列設定 */
export const INDIVIDUAL_RESERVATION_CONFIG = {
  SEMINAR: {
    sheetName: 'スキルプラス（オートウェビナー用）',
    dateColumnIndex: 0,        // A列
    pathColumnIndex: 34,       // AI列
  },
  AI: {
    sheetName: 'AI',
    dateColumnIndex: 0,        // A列
    pathColumnIndex: 46,       // AU列
  },
  SNS: {
    sheetName: 'SNS',
    dateColumnIndex: 0,        // A列
    pathColumnIndex: 46,       // AU列
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

export type PauseAction = 'PAUSE' | 'CONTINUE' | 'SKIP_NEW_CR' | 'BUDGET_DECREASE_20PCT';

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
