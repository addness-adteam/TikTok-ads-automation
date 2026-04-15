import {
  AllowableSeminarSeatCpo,
  YearMonth,
} from './allowable-seminar-seat-cpo';
import { JPY } from './jpy';

describe('YearMonth', () => {
  it('生成できる', () => {
    const ym = YearMonth.of(2026, 4);
    expect(ym.year).toBe(2026);
    expect(ym.month).toBe(4);
    expect(ym.toString()).toBe('2026-04');
  });
  it('不正月はエラー', () => {
    expect(() => YearMonth.of(2026, 0)).toThrow();
    expect(() => YearMonth.of(2026, 13)).toThrow();
  });
  it('不正年はエラー', () => {
    expect(() => YearMonth.of(1999, 1)).toThrow();
  });
  it('fromDate: JSTの月を返す', () => {
    // UTC 2026-04-30 16:00 = JST 2026-05-01 01:00
    const d = new Date(Date.UTC(2026, 3, 30, 16, 0, 0));
    const ym = YearMonth.fromDate(d);
    expect(ym.year).toBe(2026);
    expect(ym.month).toBe(5);
  });
  it('equals', () => {
    expect(YearMonth.of(2026, 4).equals(YearMonth.of(2026, 4))).toBe(true);
    expect(YearMonth.of(2026, 4).equals(YearMonth.of(2026, 5))).toBe(false);
  });
});

describe('AllowableSeminarSeatCpo', () => {
  it('月と許容額を保持する', () => {
    const vo = AllowableSeminarSeatCpo.of(YearMonth.of(2026, 4), JPY.of(15000));
    expect(vo.month.toString()).toBe('2026-04');
    expect(vo.amount.amount).toBe(15000);
  });
});
