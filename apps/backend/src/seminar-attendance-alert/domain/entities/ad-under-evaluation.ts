import { JPY } from '../value-objects/jpy';
import { DeliveryPeriod } from '../value-objects/delivery-period';

/**
 * セミナー着座CPOアラートの評価対象となる広告
 */
export class AdUnderEvaluation {
  private constructor(
    readonly adTiktokId: string,
    readonly adName: string,
    readonly advertiserName: string,
    readonly lpCrCode: string,
    readonly deliveryPeriod: DeliveryPeriod,
    readonly totalSpend: JPY,
    readonly reservationCount: number,
    readonly attendanceCount: number,
  ) {}

  static create(params: {
    adTiktokId: string;
    adName: string;
    advertiserName: string;
    lpCrCode: string;
    deliveryPeriod: DeliveryPeriod;
    totalSpend: JPY;
    reservationCount: number;
    attendanceCount: number;
  }): AdUnderEvaluation {
    if (!params.adTiktokId) throw new Error('adTiktokId is required');
    if (params.reservationCount < 0)
      throw new Error('reservationCount must be >=0');
    if (params.attendanceCount < 0)
      throw new Error('attendanceCount must be >=0');
    if (params.attendanceCount > params.reservationCount) {
      throw new Error(
        `attendanceCount(${params.attendanceCount}) cannot exceed reservationCount(${params.reservationCount})`,
      );
    }
    return new AdUnderEvaluation(
      params.adTiktokId,
      params.adName,
      params.advertiserName,
      params.lpCrCode,
      params.deliveryPeriod,
      params.totalSpend,
      params.reservationCount,
      params.attendanceCount,
    );
  }

  /** セミナー着座CPO (着座0件ならnull) */
  get seminarSeatCpo(): JPY | null {
    return JPY.perUnit(this.totalSpend, this.attendanceCount);
  }

  get hasAnyAttendance(): boolean {
    return this.attendanceCount > 0;
  }
}
