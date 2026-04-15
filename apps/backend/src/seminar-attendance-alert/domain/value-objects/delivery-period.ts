/**
 * 広告の配信期間（配信開始日〜評価時点）を表す値オブジェクト
 */
export class DeliveryPeriod {
  static readonly MIN_DAYS_FOR_ALERT = 5;

  private constructor(
    readonly startDate: Date,
    readonly evaluationDate: Date,
  ) {}

  /**
   * @param startDate AdGroup.schedule.startTime 優先、null時はAd.createdAtをフォールバック
   * @param evaluationDate 判定時点（通常は実行時刻の日付）
   */
  static between(startDate: Date, evaluationDate: Date): DeliveryPeriod {
    if (!(startDate instanceof Date) || isNaN(startDate.getTime())) {
      throw new Error(`Invalid startDate: ${startDate}`);
    }
    if (!(evaluationDate instanceof Date) || isNaN(evaluationDate.getTime())) {
      throw new Error(`Invalid evaluationDate: ${evaluationDate}`);
    }
    return new DeliveryPeriod(startDate, evaluationDate);
  }

  /** JST基準での経過日数（startDate当日を0日目として数える） */
  get elapsedDays(): number {
    // JST日付で差分を取る
    const jstStart = this.toJstDate(this.startDate);
    const jstEval = this.toJstDate(this.evaluationDate);
    const diffMs = jstEval.getTime() - jstStart.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /** アラート対象となる配信期間か (5日以上経過) */
  isLongEnough(): boolean {
    return this.elapsedDays >= DeliveryPeriod.MIN_DAYS_FOR_ALERT;
  }

  private toJstDate(d: Date): Date {
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return new Date(
      Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()),
    );
  }
}
