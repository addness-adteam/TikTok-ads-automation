import { JPY } from './jpy';

describe('JPY', () => {
  describe('of', () => {
    it('正の数値から生成できる', () => {
      expect(JPY.of(1000).amount).toBe(1000);
    });
    it('小数は四捨五入される', () => {
      expect(JPY.of(1000.5).amount).toBe(1001);
      expect(JPY.of(1000.4).amount).toBe(1000);
    });
    it('0を受け入れる', () => {
      expect(JPY.of(0).amount).toBe(0);
    });
    it('負値はエラー', () => {
      expect(() => JPY.of(-1)).toThrow();
    });
    it('NaN/Infinityはエラー', () => {
      expect(() => JPY.of(NaN)).toThrow();
      expect(() => JPY.of(Infinity)).toThrow();
    });
  });

  describe('comparisons', () => {
    it('gte: 同値・大小', () => {
      expect(JPY.of(100).gte(JPY.of(100))).toBe(true);
      expect(JPY.of(101).gte(JPY.of(100))).toBe(true);
      expect(JPY.of(99).gte(JPY.of(100))).toBe(false);
    });
    it('gt: 厳密大小', () => {
      expect(JPY.of(100).gt(JPY.of(100))).toBe(false);
      expect(JPY.of(101).gt(JPY.of(100))).toBe(true);
    });
  });

  describe('perUnit', () => {
    it('件数>0なら除算', () => {
      expect(JPY.perUnit(JPY.of(15000), 3)!.amount).toBe(5000);
    });
    it('件数0ならnull', () => {
      expect(JPY.perUnit(JPY.of(15000), 0)).toBeNull();
    });
  });

  describe('overageRate', () => {
    it('実/許容の比率', () => {
      expect(JPY.of(15000).overageRate(JPY.of(10000))).toBeCloseTo(1.5);
    });
    it('baseが0ならInfinity', () => {
      expect(JPY.of(100).overageRate(JPY.of(0))).toBe(Infinity);
    });
  });
});
