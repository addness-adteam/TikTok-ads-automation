// ============================================================================
// 広告効果測定 - ドメイン型定義
// 停止済みCRの自動効果測定 → 判定 → 次アクション提案
// ============================================================================

/** 広告の実績データ */
export interface AdPerformance {
  adName: string;
  adId: string;
  channelType: 'AI' | 'SNS' | 'SKILL_PLUS';
  account: string;
  status: 'ENABLE' | 'PAUSED' | 'STOPPED';
  daysActive: number;

  // メトリクス（累計）
  spend: number;
  optins: number;
  frontPurchases: number;
  individualReservations: number;
  closings: number;
}

/** KPI閾値 */
export interface KPIThresholds {
  allowableCPA: number;
  allowableFrontCPO: number | null;
  allowableIndResCPO: number;
}

/** 判定結果 */
export type EvaluationVerdict =
  | 'SUCCESS'           // KPI以内 → 横展開/予算増候補
  | 'PARTIAL_SUCCESS'   // CPAは良いが下流KPI未達
  | 'FAILURE'           // KPI超過 → 改善or廃止
  | 'INSUFFICIENT_DATA' // データ不足（配信日数/消化額が少ない）
  | 'MONITORING';       // 配信継続中

/** 次アクションの種別 */
export type NextActionType =
  | 'CROSS_DEPLOY'     // 別アカウントに横展開
  | 'REDEPLOY'         // 同一アカウントで再出稿（予算増含む）
  | 'CHANGE_LP'        // LP変更して再テスト
  | 'CHANGE_HOOK'      // 動画フック差し替え
  | 'ABANDON'          // 廃止（このCRは使わない）
  | 'INVESTIGATE'      // ピクセル/LP等の調査が必要
  | 'CONTINUE';        // 配信継続、経過観察

/** 次アクション */
export interface NextAction {
  type: NextActionType;
  reason: string;
}

// ============================================================================
// 仮説検証（HypothesisTest）
// ============================================================================

export type HypothesisStatus = 'PENDING' | 'RUNNING' | 'STOPPED' | 'EVALUATED';

export interface HypothesisState {
  id?: string;
  channelType: 'AI' | 'SNS' | 'SKILL_PLUS';
  hypothesis: string;
  status: HypothesisStatus;
  adId?: string;
  adName?: string;
  account?: string;

  // 効果測定結果（EVALUATED時）
  verdict?: string;
  interpretation?: string;
  nextAction?: string;

  // メトリクス
  spend?: number;
  optins?: number;
  frontPurchases?: number;
  individualRes?: number;
  cpa?: number;
  indResCPO?: number | null;

  evaluatedAt?: Date;
}

export interface TrackingProgress {
  shouldEvaluate: boolean;
  summary: string;
  earlyWarning?: string;
}

export interface EvaluationInput {
  verdict: string;
  interpretation: string;
  nextAction: string;
  spend: number;
  optins: number;
  frontPurchases: number;
  individualReservations: number;
  cpa: number;
  indResCPO: number | null;
}

/** 効果測定結果 */
export interface EvaluationResult {
  adName: string;
  adId: string;
  channelType: 'AI' | 'SNS' | 'SKILL_PLUS';
  verdict: EvaluationVerdict;
  interpretation: string;
  metrics: {
    spend: number;
    optins: number;
    frontPurchases: number;
    individualReservations: number;
    cpa: number;
    frontCPO: number | null;
    indResCPO: number | null;
  };
  kpiComparison: {
    cpaRatio: number | null;       // 実績CPA / 許容CPA（1.0以下=達成）
    frontCPORatio: number | null;
    indResCPORatio: number | null;
  };
  nextAction: NextAction;
}
