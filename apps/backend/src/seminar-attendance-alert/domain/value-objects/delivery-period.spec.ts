import { DeliveryPeriod } from './delivery-period';

describe('DeliveryPeriod', () => {
  // JST日付を作るヘルパー (UTC-9時間のJST 00:00)
  const jst = (y: number, m: number, d: number, h = 0) =>
    new Date(Date.UTC(y, m - 1, d, h - 9, 0, 0));

  describe('elapsedDays', () => {
    it('同日は0日', () => {
      const p = DeliveryPeriod.between(
        jst(2026, 4, 1, 12),
        jst(2026, 4, 1, 18),
      );
      expect(p.elapsedDays).toBe(0);
    });
    it('翌日は1日', () => {
      const p = DeliveryPeriod.between(jst(2026, 4, 1, 10), jst(2026, 4, 2, 9));
      expect(p.elapsedDays).toBe(1);
    });
    it('5日後は5日', () => {
      const p = DeliveryPeriod.between(jst(2026, 4, 1), jst(2026, 4, 6));
      expect(p.elapsedDays).toBe(5);
    });
  });

  describe('isLongEnough', () => {
    it('4日経過はfalse', () => {
      const p = DeliveryPeriod.between(jst(2026, 4, 1), jst(2026, 4, 5));
      expect(p.isLongEnough()).toBe(false);
    });
    it('5日経過はtrue（境界値）', () => {
      const p = DeliveryPeriod.between(jst(2026, 4, 1), jst(2026, 4, 6));
      expect(p.isLongEnough()).toBe(true);
    });
    it('10日経過はtrue', () => {
      const p = DeliveryPeriod.between(jst(2026, 4, 1), jst(2026, 4, 11));
      expect(p.isLongEnough()).toBe(true);
    });
  });

  describe('入力検証', () => {
    it('不正Dateはエラー', () => {
      expect(() =>
        DeliveryPeriod.between(new Date('invalid'), new Date()),
      ).toThrow();
    });
  });
});
