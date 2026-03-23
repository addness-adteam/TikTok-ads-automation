// ============================================================================
// 仮説検証トラッカー - 状態遷移ロジック
// PENDING → RUNNING → STOPPED → EVALUATED
// ============================================================================

import { HypothesisState, TrackingProgress, EvaluationInput } from './types';

/** CPA警告閾値（消化額÷オプト数がこの倍率以上なら早期警告） */
const EARLY_WARNING_CPA_MULTIPLIER = 2.5;
/** 早期警告の最低消化額 */
const EARLY_WARNING_MIN_SPEND = 10000;

/** 仮説を作成（PENDING状態） */
export function createHypothesis(input: {
  channelType: 'AI' | 'SNS' | 'SKILL_PLUS';
  hypothesis: string;
}): HypothesisState {
  return {
    channelType: input.channelType,
    hypothesis: input.hypothesis,
    status: 'PENDING',
  };
}

/** 広告IDを紐付けて追跡開始（RUNNING状態） */
export function startTracking(
  hypothesis: HypothesisState,
  adInfo: { adId: string; adName: string; account: string },
): HypothesisState {
  return {
    ...hypothesis,
    status: 'RUNNING',
    adId: adInfo.adId,
    adName: adInfo.adName,
    account: adInfo.account,
  };
}

/** 配信中の経過チェック */
export function checkProgress(metrics: {
  daysActive: number;
  spend: number;
  optins: number;
  frontPurchases: number;
  individualReservations: number;
  isStillRunning: boolean;
}): TrackingProgress {
  // 停止済み → 効果測定すべき
  if (!metrics.isStillRunning) {
    return {
      shouldEvaluate: true,
      summary: `停止済み（${metrics.daysActive}日間、消化¥${metrics.spend.toLocaleString()}、オプト${metrics.optins}件）→ 効果測定実行`,
    };
  }

  // 配信中 → 早期警告チェック
  let earlyWarning: string | undefined;
  if (metrics.spend >= EARLY_WARNING_MIN_SPEND && metrics.optins > 0) {
    const cpa = metrics.spend / metrics.optins;
    // CPAが一般的な許容CPAの2.5倍以上なら警告
    if (cpa > 6000 * EARLY_WARNING_CPA_MULTIPLIER) {
      earlyWarning = `CPA ¥${cpa.toFixed(0)}が高い。早期停止を検討`;
    }
  } else if (metrics.spend >= EARLY_WARNING_MIN_SPEND && metrics.optins === 0) {
    earlyWarning = `消化¥${metrics.spend.toLocaleString()}でオプト0件。ピクセル/LP確認`;
  }

  return {
    shouldEvaluate: false,
    summary: `配信中（${metrics.daysActive}日目、消化¥${metrics.spend.toLocaleString()}、オプト${metrics.optins}件、フロント${metrics.frontPurchases}件、個別予約${metrics.individualReservations}件）`,
    earlyWarning,
  };
}

/** 仮説を効果測定結果で更新（EVALUATED状態） */
export function evaluateHypothesis(
  hypothesis: HypothesisState,
  result: EvaluationInput,
): HypothesisState {
  return {
    ...hypothesis,
    status: 'EVALUATED',
    verdict: result.verdict,
    interpretation: result.interpretation,
    nextAction: result.nextAction,
    spend: result.spend,
    optins: result.optins,
    frontPurchases: result.frontPurchases,
    individualRes: result.individualReservations,
    cpa: result.cpa,
    indResCPO: result.indResCPO,
    evaluatedAt: new Date(),
  };
}
