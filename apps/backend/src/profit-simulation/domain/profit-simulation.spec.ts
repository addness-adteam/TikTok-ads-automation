import {
  calculateProfitSimulation,
  calculateTotalProfitSummary,
} from './profit-simulation';
import { ProfitSimulation } from './types';

describe('ProfitSimulation', () => {
  describe('calculateProfitSimulation', () => {
    it('日割り計算で月末着地を推定する', () => {
      const result = calculateProfitSimulation({
        channelType: 'AI',
        year: 2026,
        month: 3,
        actualDays: 21,
        totalDaysInMonth: 31,
        actualAdSpend: 2_601_891,
        actualRevenue: 3_615_800,
        targetProfit: 20_000_000,
      });

      expect(result.channelType).toBe('AI');
      expect(result.period).toEqual({ year: 2026, month: 3 });
      expect(result.actualProfit).toBe(3_615_800 - 2_601_891);

      // 推定月末 = (実績 / 21) × 31
      const expectedProjectedAdSpend = Math.round((2_601_891 / 21) * 31);
      const expectedProjectedRevenue = Math.round((3_615_800 / 21) * 31);
      expect(result.projectedAdSpend).toBe(expectedProjectedAdSpend);
      expect(result.projectedRevenue).toBe(expectedProjectedRevenue);

      const expectedProjectedProfit = expectedProjectedRevenue - expectedProjectedAdSpend;
      expect(result.projectedProfit).toBe(expectedProjectedProfit);

      expect(result.gapToTarget).toBe(expectedProjectedProfit - 20_000_000);
      expect(result.isOnTrack).toBe(expectedProjectedProfit >= 20_000_000);
    });

    it('目標到達見込みありの場合isOnTrack=true', () => {
      const result = calculateProfitSimulation({
        channelType: 'SNS',
        year: 2026,
        month: 3,
        actualDays: 21,
        totalDaysInMonth: 31,
        actualAdSpend: 300_000,
        actualRevenue: 1_600_000,
        targetProfit: 1_000_000,
      });

      // 実績粗利: 1,300,000
      // 推定月末粗利: (1,300,000 / 21) * 31 ≈ 1,919,048
      expect(result.isOnTrack).toBe(true);
      expect(result.gapToTarget).toBeGreaterThan(0);
    });

    it('目標未達見込みの場合isOnTrack=false', () => {
      const result = calculateProfitSimulation({
        channelType: 'AI',
        year: 2026,
        month: 3,
        actualDays: 21,
        totalDaysInMonth: 31,
        actualAdSpend: 2_601_891,
        actualRevenue: 3_615_800,
        targetProfit: 20_000_000,
      });

      // 推定粗利 ≈ 1,496,XXX << 20,000,000
      expect(result.isOnTrack).toBe(false);
      expect(result.gapToTarget).toBeLessThan(0);
    });

    it('実績日数が0の場合、推定値は全て0', () => {
      const result = calculateProfitSimulation({
        channelType: 'AI',
        year: 2026,
        month: 4,
        actualDays: 0,
        totalDaysInMonth: 30,
        actualAdSpend: 0,
        actualRevenue: 0,
        targetProfit: 20_000_000,
      });

      expect(result.projectedAdSpend).toBe(0);
      expect(result.projectedRevenue).toBe(0);
      expect(result.projectedProfit).toBe(0);
      expect(result.isOnTrack).toBe(false);
    });

    it('月末最終日（実績日数=総日数）の場合、推定値=実績値', () => {
      const result = calculateProfitSimulation({
        channelType: 'SNS',
        year: 2026,
        month: 3,
        actualDays: 31,
        totalDaysInMonth: 31,
        actualAdSpend: 500_000,
        actualRevenue: 2_000_000,
        targetProfit: 1_000_000,
      });

      expect(result.projectedAdSpend).toBe(500_000);
      expect(result.projectedRevenue).toBe(2_000_000);
      expect(result.projectedProfit).toBe(1_500_000);
    });
  });

  describe('calculateTotalProfitSummary', () => {
    it('全導線のサマリーを算出する', () => {
      const channels: ProfitSimulation[] = [
        {
          channelType: 'AI', period: { year: 2026, month: 3 },
          actualDays: 21, actualAdSpend: 2_601_891, actualRevenue: 3_615_800,
          actualProfit: 1_013_909,
          totalDaysInMonth: 31,
          projectedAdSpend: 3_840_887, projectedRevenue: 5_337_610,
          projectedProfit: 1_496_723,
          targetProfit: 20_000_000, gapToTarget: -18_503_277, isOnTrack: false,
        },
        {
          channelType: 'SNS', period: { year: 2026, month: 3 },
          actualDays: 21, actualAdSpend: 328_789, actualRevenue: 1_659_040,
          actualProfit: 1_330_251,
          totalDaysInMonth: 31,
          projectedAdSpend: 485_403, projectedRevenue: 2_449_059,
          projectedProfit: 1_963_656,
          targetProfit: 10_000_000, gapToTarget: -8_036_344, isOnTrack: false,
        },
        {
          channelType: 'SKILL_PLUS', period: { year: 2026, month: 3 },
          actualDays: 21, actualAdSpend: 1_080_256, actualRevenue: 5_637_000,
          actualProfit: 4_556_744,
          totalDaysInMonth: 31,
          projectedAdSpend: 1_594_664, projectedRevenue: 8_321_000,
          projectedProfit: 6_726_336,
          targetProfit: 10_000_000, gapToTarget: -3_273_664, isOnTrack: false,
        },
      ];

      const summary = calculateTotalProfitSummary(channels, { year: 2026, month: 3 });

      expect(summary.period).toEqual({ year: 2026, month: 3 });
      expect(summary.channels).toHaveLength(3);
      expect(summary.totalActualProfit).toBe(1_013_909 + 1_330_251 + 4_556_744);
      expect(summary.totalProjectedProfit).toBe(1_496_723 + 1_963_656 + 6_726_336);
      expect(summary.totalTargetProfit).toBe(20_000_000 + 10_000_000 + 10_000_000);
      expect(summary.totalGapToTarget).toBe(
        summary.totalProjectedProfit - summary.totalTargetProfit,
      );
      expect(summary.isOnTrack).toBe(false);
    });

    it('全導線が目標到達ならisOnTrack=true', () => {
      const channels: ProfitSimulation[] = [
        {
          channelType: 'AI', period: { year: 2026, month: 3 },
          actualDays: 31, actualAdSpend: 1_000_000, actualRevenue: 25_000_000,
          actualProfit: 24_000_000,
          totalDaysInMonth: 31,
          projectedAdSpend: 1_000_000, projectedRevenue: 25_000_000,
          projectedProfit: 24_000_000,
          targetProfit: 20_000_000, gapToTarget: 4_000_000, isOnTrack: true,
        },
      ];

      const summary = calculateTotalProfitSummary(channels, { year: 2026, month: 3 });

      expect(summary.isOnTrack).toBe(true);
    });
  });
});
