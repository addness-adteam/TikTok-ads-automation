/**
 * 円建て金額を表す値オブジェクト
 */
export class JPY {
  private constructor(private readonly _amount: number) {}

  static of(amount: number): JPY {
    if (!Number.isFinite(amount)) {
      throw new Error(`JPY amount must be finite, got: ${amount}`);
    }
    if (amount < 0) {
      throw new Error(`JPY amount must be non-negative, got: ${amount}`);
    }
    return new JPY(Math.round(amount));
  }

  get amount(): number {
    return this._amount;
  }

  gte(other: JPY): boolean {
    return this._amount >= other._amount;
  }

  gt(other: JPY): boolean {
    return this._amount > other._amount;
  }

  /** 広告費 ÷ 件数 でCPO/CPAを算出。件数0ならnullを返す */
  static perUnit(total: JPY, units: number): JPY | null {
    if (units <= 0) return null;
    return JPY.of(total._amount / units);
  }

  /** 超過率 (this / base) */
  overageRate(base: JPY): number {
    if (base._amount === 0) return Infinity;
    return this._amount / base._amount;
  }

  toString(): string {
    return `¥${this._amount.toLocaleString()}`;
  }
}
