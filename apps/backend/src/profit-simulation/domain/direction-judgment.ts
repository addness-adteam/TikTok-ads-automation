// ============================================================================
// 改善方向の判定ロジック
// ============================================================================

import { ImprovementDirection, DirectionJudgment } from './types';

interface DirectionInput {
  currentROAS: number;
  targetROAS: number;
  currentAcquisition: number;
  requiredAcquisition: number;
}

/** 必要集客数を算出: 目標粗利 / (オプトLTV - CPA) */
export function calculateRequiredAcquisition(
  targetProfit: number,
  optinLTV: number,
  cpa: number,
): number {
  const profitPerOptin = optinLTV - cpa;
  if (profitPerOptin <= 0) {
    return Infinity;
  }
  return Math.ceil(targetProfit / profitPerOptin);
}

/** ROAS vs 集客数の改善方向を判定する */
export function judgeDirection(input: DirectionInput): DirectionJudgment {
  const { currentROAS, targetROAS, currentAcquisition, requiredAcquisition } = input;

  const roasOk = currentROAS >= targetROAS;
  const acquisitionOk = isFinite(requiredAcquisition) && currentAcquisition >= requiredAcquisition;

  let direction: ImprovementDirection;
  let reason: string;

  if (roasOk && acquisitionOk) {
    direction = 'ON_TRACK';
    reason = '目標到達見込み。現状維持。';
  } else if (!roasOk && !acquisitionOk) {
    direction = 'BOTH';
    reason = 'ROASも集客数も不足。ファネル効率改善とスケーリングの両方が必要。';
  } else if (!roasOk) {
    direction = 'IMPROVE_ROAS';
    reason = '集客は足りているがROASが低い。ファネル効率の改善が必要。';
  } else {
    direction = 'INCREASE_ACQUISITION';
    reason = 'ROASは健全だが集客数が不足。スケーリング（横展開・再出稿・予算増）が必要。';
  }

  return {
    direction,
    reason,
    currentROAS,
    targetROAS,
    currentAcquisition,
    requiredAcquisition,
  };
}
