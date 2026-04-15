// ============================================================================
// 利益シミュレーション（日割り計算）
// ============================================================================

import { ProfitSimulation, TotalProfitSummary } from './types';

interface ProfitSimulationInput {
  channelType: ProfitSimulation['channelType'];
  year: number;
  month: number;
  actualDays: number;
  totalDaysInMonth: number;
  actualAdSpend: number;
  actualRevenue: number;
  targetProfit: number;
}

/** 日割り計算で月末着地を推定する */
export function calculateProfitSimulation(
  input: ProfitSimulationInput,
): ProfitSimulation {
  const {
    channelType,
    year,
    month,
    actualDays,
    totalDaysInMonth,
    actualAdSpend,
    actualRevenue,
    targetProfit,
  } = input;

  const actualProfit = actualRevenue - actualAdSpend;

  // 実績日数が0の場合、推定不能
  const ratio = actualDays > 0 ? totalDaysInMonth / actualDays : 0;

  const projectedAdSpend = Math.round(actualAdSpend * ratio);
  const projectedRevenue = Math.round(actualRevenue * ratio);
  const projectedProfit = projectedRevenue - projectedAdSpend;

  const gapToTarget = projectedProfit - targetProfit;
  const isOnTrack = projectedProfit >= targetProfit;

  return {
    channelType,
    period: { year, month },
    actualDays,
    actualAdSpend,
    actualRevenue,
    actualProfit,
    totalDaysInMonth,
    projectedAdSpend,
    projectedRevenue,
    projectedProfit,
    targetProfit,
    gapToTarget,
    isOnTrack,
  };
}

/** 全導線サマリーを算出する */
export function calculateTotalProfitSummary(
  channels: ProfitSimulation[],
  period: { year: number; month: number },
): TotalProfitSummary {
  const totalActualProfit = channels.reduce(
    (sum, c) => sum + c.actualProfit,
    0,
  );
  const totalProjectedProfit = channels.reduce(
    (sum, c) => sum + c.projectedProfit,
    0,
  );
  const totalTargetProfit = channels.reduce(
    (sum, c) => sum + c.targetProfit,
    0,
  );
  const totalGapToTarget = totalProjectedProfit - totalTargetProfit;

  return {
    period,
    channels,
    totalActualProfit,
    totalProjectedProfit,
    totalTargetProfit,
    totalGapToTarget,
    isOnTrack: totalProjectedProfit >= totalTargetProfit,
  };
}
