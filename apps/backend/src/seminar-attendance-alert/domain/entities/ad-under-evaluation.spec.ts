import { AdUnderEvaluation } from './ad-under-evaluation';
import { DeliveryPeriod } from '../value-objects/delivery-period';
import { JPY } from '../value-objects/jpy';

const jst = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d, -9, 0, 0));

const baseParams = {
  adTiktokId: '1234',
  adName: 'test ad',
  advertiserName: 'SP1',
  lpCrCode: 'LP2-CR00500',
  deliveryPeriod: DeliveryPeriod.between(jst(2026, 4, 1), jst(2026, 4, 6)),
  totalSpend: JPY.of(50000),
  reservationCount: 10,
  attendanceCount: 3,
};

describe('AdUnderEvaluation', () => {
  it('正常生成', () => {
    const ad = AdUnderEvaluation.create(baseParams);
    expect(ad.adTiktokId).toBe('1234');
    expect(ad.seminarSeatCpo?.amount).toBe(Math.round(50000 / 3));
    expect(ad.hasAnyAttendance).toBe(true);
  });
  it('attendance > reservation はエラー', () => {
    expect(() =>
      AdUnderEvaluation.create({ ...baseParams, attendanceCount: 11 }),
    ).toThrow();
  });
  it('負値はエラー', () => {
    expect(() =>
      AdUnderEvaluation.create({ ...baseParams, reservationCount: -1 }),
    ).toThrow();
    expect(() =>
      AdUnderEvaluation.create({ ...baseParams, attendanceCount: -1 }),
    ).toThrow();
  });
  it('着座0件ならseminarSeatCpoはnull', () => {
    const ad = AdUnderEvaluation.create({ ...baseParams, attendanceCount: 0 });
    expect(ad.seminarSeatCpo).toBeNull();
    expect(ad.hasAnyAttendance).toBe(false);
  });
});
