import { AdUnderEvaluation } from '../entities/ad-under-evaluation';
import { AllowableSeminarSeatCpo } from '../value-objects/allowable-seminar-seat-cpo';

export type AlertReason =
  | 'CPO_EXCEEDED' // 着座あり + 実CPO > 許容CPO
  | 'ZERO_ATTENDANCE_WITH_SPEND'; // 着座0件 + spend ≥ 許容CPO

export interface AlertDecision {
  shouldAlert: boolean;
  reason: AlertReason | null;
  /** デバッグ用: 判定に使った補助情報 */
  detail: {
    elapsedDays: number;
    actualCpoAmount: number | null; // 着座0件時はnull
    allowableCpoAmount: number;
    overageRate: number | null; // 着座0件時はnull
    spendAmount: number;
    alreadyAlerted: boolean;
  };
}

/**
 * アラート発火ルール評価ドメインサービス
 *
 * 発火条件 (AND):
 *   1. 配信5日以上経過
 *   2. 以下いずれか:
 *      (a) 着座>0 かつ 実CPO > 許容CPO
 *      (b) 着座=0 かつ spend >= 許容CPO
 *   3. 過去に未通知
 */
export class AlertRuleEvaluator {
  evaluate(
    ad: AdUnderEvaluation,
    allowable: AllowableSeminarSeatCpo,
    alreadyAlerted: boolean,
  ): AlertDecision {
    const elapsedDays = ad.deliveryPeriod.elapsedDays;
    const actualCpo = ad.seminarSeatCpo;
    const detailBase = {
      elapsedDays,
      actualCpoAmount: actualCpo?.amount ?? null,
      allowableCpoAmount: allowable.amount.amount,
      overageRate: actualCpo ? actualCpo.overageRate(allowable.amount) : null,
      spendAmount: ad.totalSpend.amount,
      alreadyAlerted,
    };

    if (alreadyAlerted) {
      return { shouldAlert: false, reason: null, detail: detailBase };
    }
    if (!ad.deliveryPeriod.isLongEnough()) {
      return { shouldAlert: false, reason: null, detail: detailBase };
    }

    if (ad.hasAnyAttendance) {
      // 着座>0: 実CPO > 許容CPO
      if (actualCpo && actualCpo.gt(allowable.amount)) {
        return {
          shouldAlert: true,
          reason: 'CPO_EXCEEDED',
          detail: detailBase,
        };
      }
      return { shouldAlert: false, reason: null, detail: detailBase };
    } else {
      // 着座=0: spend >= 許容CPO
      if (ad.totalSpend.gte(allowable.amount)) {
        return {
          shouldAlert: true,
          reason: 'ZERO_ATTENDANCE_WITH_SPEND',
          detail: detailBase,
        };
      }
      return { shouldAlert: false, reason: null, detail: detailBase };
    }
  }
}
