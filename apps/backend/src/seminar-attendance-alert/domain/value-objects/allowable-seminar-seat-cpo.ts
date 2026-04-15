import { JPY } from './jpy';

/** YYYY-MM 形式の年月 */
export class YearMonth {
  private constructor(
    readonly year: number,
    readonly month: number,
  ) {}

  static of(year: number, month: number): YearMonth {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new Error(`Invalid year: ${year}`);
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error(`Invalid month: ${month}`);
    }
    return new YearMonth(year, month);
  }

  static fromDate(d: Date): YearMonth {
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return YearMonth.of(jst.getUTCFullYear(), jst.getUTCMonth() + 1);
  }

  equals(other: YearMonth): boolean {
    return this.year === other.year && this.month === other.month;
  }

  toString(): string {
    return `${this.year}-${String(this.month).padStart(2, '0')}`;
  }
}

/** 月次の許容セミナー着座CPO */
export class AllowableSeminarSeatCpo {
  private constructor(
    readonly month: YearMonth,
    readonly amount: JPY,
  ) {}

  static of(month: YearMonth, amount: JPY): AllowableSeminarSeatCpo {
    return new AllowableSeminarSeatCpo(month, amount);
  }
}
