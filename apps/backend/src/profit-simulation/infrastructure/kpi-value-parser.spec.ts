import {
  parseKpiValue,
  parseKpiPercentage,
  parseKpiAmount,
} from './kpi-value-parser';

describe('KpiValueParser', () => {
  describe('parseKpiPercentage', () => {
    it('全角パーセント "7.9％" → 0.079', () => {
      expect(parseKpiPercentage('7.9％')).toBeCloseTo(0.079, 4);
    });

    it('半角パーセント "300%" → 3.0', () => {
      expect(parseKpiPercentage('300%')).toBeCloseTo(3.0, 4);
    });

    it('小数（比率） "0.7613" → 0.7613', () => {
      expect(parseKpiPercentage('0.7613')).toBeCloseTo(0.7613, 4);
    });

    it('半角パーセント "5.88%" → 0.0588', () => {
      expect(parseKpiPercentage('5.88%')).toBeCloseTo(0.0588, 4);
    });

    it('半角パーセント "200.0%" → 2.0', () => {
      expect(parseKpiPercentage('200.0%')).toBeCloseTo(2.0, 4);
    });

    it('半角パーセント "38.00%" → 0.38', () => {
      expect(parseKpiPercentage('38.00%')).toBeCloseTo(0.38, 4);
    });

    it('小数 "1" → 1.0', () => {
      expect(parseKpiPercentage('1')).toBeCloseTo(1.0, 4);
    });
  });

  describe('parseKpiAmount', () => {
    it('円マーク付き "¥48,830" → 48830', () => {
      expect(parseKpiAmount('¥48,830')).toBe(48830);
    });

    it('カンマ付き数値 "652,306" → 652306', () => {
      expect(parseKpiAmount('652,306')).toBe(652306);
    });

    it('プレーン数値 "652306" → 652306', () => {
      expect(parseKpiAmount('652306')).toBe(652306);
    });

    it('漢字単位 "2000万" → 20000000', () => {
      expect(parseKpiAmount('2000万')).toBe(20_000_000);
    });

    it('漢字単位 "1000万" → 10000000', () => {
      expect(parseKpiAmount('1000万')).toBe(10_000_000);
    });

    it('円マーク+カンマ "¥223,758" → 223758', () => {
      expect(parseKpiAmount('¥223,758')).toBe(223758);
    });
  });

  describe('parseKpiValue（自動判定）', () => {
    it('パーセント記号があれば比率として解析', () => {
      expect(parseKpiValue('7.9％')).toBeCloseTo(0.079, 4);
      expect(parseKpiValue('300%')).toBeCloseTo(3.0, 4);
    });

    it('円マークがあれば金額として解析', () => {
      expect(parseKpiValue('¥48,830')).toBe(48830);
    });

    it('万があれば金額として解析', () => {
      expect(parseKpiValue('2000万')).toBe(20_000_000);
    });

    it('0-1の小数は比率として解析', () => {
      expect(parseKpiValue('0.7613')).toBeCloseTo(0.7613, 4);
    });

    it('大きな数値は金額として解析', () => {
      expect(parseKpiValue('652306')).toBe(652306);
    });

    it('空文字はNaN', () => {
      expect(parseKpiValue('')).toBeNaN();
    });

    it('nullish値はNaN', () => {
      expect(parseKpiValue(undefined as any)).toBeNaN();
      expect(parseKpiValue(null as any)).toBeNaN();
    });
  });
});
