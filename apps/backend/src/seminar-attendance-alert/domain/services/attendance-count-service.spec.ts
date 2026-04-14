import { AttendanceCountService } from './attendance-count-service';

describe('AttendanceCountService.countByLpCr', () => {
  const svc = new AttendanceCountService();

  it('基本: 予約3人・着座2人がLP-CR1に紐付く', () => {
    const optMap = new Map([
      ['a@x.com', { lpCr: 'LP2-CR00500', timestamp: new Date('2026-04-01') }],
      ['b@x.com', { lpCr: 'LP2-CR00500', timestamp: new Date('2026-04-02') }],
      ['c@x.com', { lpCr: 'LP2-CR00500', timestamp: new Date('2026-04-03') }],
    ]);
    const reservations = [
      { email: 'a@x.com', reservedAt: new Date('2026-04-05') },
      { email: 'b@x.com', reservedAt: new Date('2026-04-05') },
      { email: 'c@x.com', reservedAt: new Date('2026-04-05') },
    ];
    const attended = new Set(['a@x.com', 'b@x.com']);
    const result = svc.countByLpCr(optMap, reservations, attended);
    expect(result.get('LP2-CR00500')).toEqual({ reservationCount: 3, attendanceCount: 2 });
  });

  it('複数LP-CRに分散', () => {
    const optMap = new Map([
      ['a@x.com', { lpCr: 'LP2-CR00100', timestamp: new Date() }],
      ['b@x.com', { lpCr: 'LP2-CR00200', timestamp: new Date() }],
    ]);
    const reservations = [
      { email: 'a@x.com', reservedAt: new Date() },
      { email: 'b@x.com', reservedAt: new Date() },
    ];
    const attended = new Set(['a@x.com']);
    const result = svc.countByLpCr(optMap, reservations, attended);
    expect(result.get('LP2-CR00100')!.reservationCount).toBe(1);
    expect(result.get('LP2-CR00100')!.attendanceCount).toBe(1);
    expect(result.get('LP2-CR00200')!.reservationCount).toBe(1);
    expect(result.get('LP2-CR00200')!.attendanceCount).toBe(0);
  });

  it('オプトにないメアドはカウント対象外', () => {
    const optMap = new Map([
      ['a@x.com', { lpCr: 'LP2-CR00500', timestamp: new Date() }],
    ]);
    const reservations = [
      { email: 'a@x.com', reservedAt: new Date() },
      { email: 'noopt@x.com', reservedAt: new Date() },
    ];
    const attended = new Set<string>();
    const result = svc.countByLpCr(optMap, reservations, attended);
    expect(result.get('LP2-CR00500')!.reservationCount).toBe(1);
    expect(result.size).toBe(1);
  });

  it('メアド大文字小文字違いでも正しく突合', () => {
    const optMap = new Map([
      ['foo@x.com', { lpCr: 'LP2-CR00500', timestamp: new Date() }],
    ]);
    const reservations = [{ email: 'FOO@X.COM', reservedAt: new Date() }];
    const attended = new Set(['Foo@X.Com']);
    const result = svc.countByLpCr(optMap, reservations, attended);
    expect(result.get('LP2-CR00500')).toEqual({ reservationCount: 1, attendanceCount: 1 });
  });

  it('空入力でも空Mapを返す', () => {
    const result = svc.countByLpCr(new Map(), [], new Set());
    expect(result.size).toBe(0);
  });

  it('LP-CRは大文字統一される', () => {
    const optMap = new Map([
      ['a@x.com', { lpCr: 'lp2-cr00500', timestamp: new Date() }],
    ]);
    const reservations = [{ email: 'a@x.com', reservedAt: new Date() }];
    const result = svc.countByLpCr(optMap, reservations, new Set());
    expect(result.has('LP2-CR00500')).toBe(true);
    expect(result.has('lp2-cr00500')).toBe(false);
  });
});
