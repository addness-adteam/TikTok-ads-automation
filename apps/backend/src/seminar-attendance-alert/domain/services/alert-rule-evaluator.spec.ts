import { AlertRuleEvaluator } from './alert-rule-evaluator';
import { AdUnderEvaluation } from '../entities/ad-under-evaluation';
import { DeliveryPeriod } from '../value-objects/delivery-period';
import { JPY } from '../value-objects/jpy';
import {
  AllowableSeminarSeatCpo,
  YearMonth,
} from '../value-objects/allowable-seminar-seat-cpo';

const jst = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d, -9, 0, 0));

const allowable = AllowableSeminarSeatCpo.of(
  YearMonth.of(2026, 4),
  JPY.of(15000),
);

const makeAd = (
  override: Partial<Parameters<typeof AdUnderEvaluation.create>[0]>,
) =>
  AdUnderEvaluation.create({
    adTiktokId: '1234',
    adName: 'test',
    advertiserName: 'SP1',
    lpCrCode: 'LP2-CR00500',
    deliveryPeriod: DeliveryPeriod.between(jst(2026, 4, 1), jst(2026, 4, 8)), // 7日経過
    totalSpend: JPY.of(60000),
    reservationCount: 10,
    attendanceCount: 3,
    ...override,
  });

describe('AlertRuleEvaluator', () => {
  const evaluator = new AlertRuleEvaluator();

  describe('配信期間', () => {
    it('4日経過はアラート対象外', () => {
      const ad = makeAd({
        deliveryPeriod: DeliveryPeriod.between(
          jst(2026, 4, 1),
          jst(2026, 4, 5),
        ),
      });
      const decision = evaluator.evaluate(ad, allowable, false);
      expect(decision.shouldAlert).toBe(false);
    });
    it('5日経過はアラート判定に入る（境界値）', () => {
      const ad = makeAd({
        deliveryPeriod: DeliveryPeriod.between(
          jst(2026, 4, 1),
          jst(2026, 4, 6),
        ),
        // CPO超過 (60000/3=20000 > 15000)
      });
      const decision = evaluator.evaluate(ad, allowable, false);
      expect(decision.shouldAlert).toBe(true);
    });
  });

  describe('着座あり', () => {
    it('実CPO > 許容 → アラート (reason=CPO_EXCEEDED)', () => {
      const ad = makeAd({ totalSpend: JPY.of(60000), attendanceCount: 3 }); // 20000
      const decision = evaluator.evaluate(ad, allowable, false);
      expect(decision.shouldAlert).toBe(true);
      expect(decision.reason).toBe('CPO_EXCEEDED');
    });
    it('実CPO = 許容 → アラート対象外', () => {
      const ad = makeAd({ totalSpend: JPY.of(45000), attendanceCount: 3 }); // 15000
      const decision = evaluator.evaluate(ad, allowable, false);
      expect(decision.shouldAlert).toBe(false);
    });
    it('実CPO < 許容 → アラート対象外', () => {
      const ad = makeAd({ totalSpend: JPY.of(30000), attendanceCount: 3 }); // 10000
      const decision = evaluator.evaluate(ad, allowable, false);
      expect(decision.shouldAlert).toBe(false);
    });
  });

  describe('着座0件', () => {
    it('spend >= 許容CPO → アラート (reason=ZERO_ATTENDANCE_WITH_SPEND)', () => {
      const ad = makeAd({
        totalSpend: JPY.of(15000),
        attendanceCount: 0,
        reservationCount: 5,
      });
      const decision = evaluator.evaluate(ad, allowable, false);
      expect(decision.shouldAlert).toBe(true);
      expect(decision.reason).toBe('ZERO_ATTENDANCE_WITH_SPEND');
    });
    it('spend > 許容CPO → アラート', () => {
      const ad = makeAd({
        totalSpend: JPY.of(50000),
        attendanceCount: 0,
        reservationCount: 0,
      });
      const decision = evaluator.evaluate(ad, allowable, false);
      expect(decision.shouldAlert).toBe(true);
    });
    it('spend < 許容CPO → アラート対象外 (まだ予算消化不十分)', () => {
      const ad = makeAd({
        totalSpend: JPY.of(14999),
        attendanceCount: 0,
        reservationCount: 0,
      });
      const decision = evaluator.evaluate(ad, allowable, false);
      expect(decision.shouldAlert).toBe(false);
    });
  });

  describe('重複抑止', () => {
    it('通知済みならfalse', () => {
      const ad = makeAd({ totalSpend: JPY.of(100000), attendanceCount: 3 });
      const decision = evaluator.evaluate(ad, allowable, true);
      expect(decision.shouldAlert).toBe(false);
    });
  });

  describe('detail出力', () => {
    it('必要情報が揃う', () => {
      const ad = makeAd({ totalSpend: JPY.of(60000), attendanceCount: 3 });
      const decision = evaluator.evaluate(ad, allowable, false);
      expect(decision.detail.elapsedDays).toBe(7);
      expect(decision.detail.actualCpoAmount).toBe(20000);
      expect(decision.detail.allowableCpoAmount).toBe(15000);
      expect(decision.detail.overageRate).toBeCloseTo(20000 / 15000);
      expect(decision.detail.spendAmount).toBe(60000);
      expect(decision.detail.alreadyAlerted).toBe(false);
    });
    it('着座0件時のoverageRateはnull', () => {
      const ad = makeAd({
        totalSpend: JPY.of(20000),
        attendanceCount: 0,
        reservationCount: 0,
      });
      const decision = evaluator.evaluate(ad, allowable, false);
      expect(decision.detail.actualCpoAmount).toBeNull();
      expect(decision.detail.overageRate).toBeNull();
    });
  });
});
