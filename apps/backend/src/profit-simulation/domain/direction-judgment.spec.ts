import {
  judgeDirection,
  calculateRequiredAcquisition,
} from './direction-judgment';

describe('DirectionJudgment', () => {
  describe('calculateRequiredAcquisition', () => {
    it('目標粗利 / (LTV - CPA) で必要オプト数を算出', () => {
      // 目標粗利: 20,000,000円, LTV: 4,537円, CPA: 3,591円
      // 必要オプト数 = 20,000,000 / (4,537 - 3,591) = 20,000,000 / 946 ≈ 21,142
      const result = calculateRequiredAcquisition(20_000_000, 4_537, 3_591);
      expect(result).toBe(Math.ceil(20_000_000 / (4_537 - 3_591)));
    });

    it('LTV <= CPAの場合（赤字構造）、Infinityを返す', () => {
      const result = calculateRequiredAcquisition(10_000_000, 3_000, 5_000);
      expect(result).toBe(Infinity);
    });

    it('LTV == CPAの場合もInfinity', () => {
      const result = calculateRequiredAcquisition(10_000_000, 3_000, 3_000);
      expect(result).toBe(Infinity);
    });
  });

  describe('judgeDirection', () => {
    it('ON_TRACK: ROAS達成 かつ 集客数十分', () => {
      const result = judgeDirection({
        currentROAS: 4.0,
        targetROAS: 3.0,
        currentAcquisition: 500,
        requiredAcquisition: 400,
      });

      expect(result.direction).toBe('ON_TRACK');
    });

    it('IMPROVE_ROAS: ROAS未達 かつ 集客数十分', () => {
      const result = judgeDirection({
        currentROAS: 2.0,
        targetROAS: 3.0,
        currentAcquisition: 500,
        requiredAcquisition: 400,
      });

      expect(result.direction).toBe('IMPROVE_ROAS');
      expect(result.reason).toContain('ROAS');
    });

    it('INCREASE_ACQUISITION: ROAS達成 かつ 集客数不足', () => {
      const result = judgeDirection({
        currentROAS: 4.0,
        targetROAS: 3.0,
        currentAcquisition: 200,
        requiredAcquisition: 400,
      });

      expect(result.direction).toBe('INCREASE_ACQUISITION');
      expect(result.reason).toContain('集客');
    });

    it('BOTH: ROAS未達 かつ 集客数不足', () => {
      const result = judgeDirection({
        currentROAS: 2.0,
        targetROAS: 3.0,
        currentAcquisition: 200,
        requiredAcquisition: 400,
      });

      expect(result.direction).toBe('BOTH');
    });

    it('ROAS境界値（ちょうど目標と同じ）はON_TRACK扱い', () => {
      const result = judgeDirection({
        currentROAS: 3.0,
        targetROAS: 3.0,
        currentAcquisition: 400,
        requiredAcquisition: 400,
      });

      expect(result.direction).toBe('ON_TRACK');
    });

    it('必要集客数がInfinity（赤字構造）の場合はBOTH', () => {
      const result = judgeDirection({
        currentROAS: 0.5,
        targetROAS: 3.0,
        currentAcquisition: 500,
        requiredAcquisition: Infinity,
      });

      expect(result.direction).toBe('BOTH');
    });
  });
});
