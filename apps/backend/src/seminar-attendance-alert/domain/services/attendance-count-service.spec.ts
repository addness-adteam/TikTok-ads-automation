import { AttendanceCountService } from './attendance-count-service';

describe('AttendanceCountService.countByLpCr', () => {
  const svc = new AttendanceCountService();

  const r = (email: string, lineName: string) => ({
    email,
    lineName,
    reservedAt: new Date('2026-04-05'),
  });

  it('基本: 予約3人・着座2人がLP-CR1に紐付く (LINE名で着座判定)', () => {
    const optMap = new Map([
      ['a@x.com', { lpCr: 'LP2-CR00500', timestamp: new Date() }],
      ['b@x.com', { lpCr: 'LP2-CR00500', timestamp: new Date() }],
      ['c@x.com', { lpCr: 'LP2-CR00500', timestamp: new Date() }],
    ]);
    const reservations = [
      r('a@x.com', '田中'),
      r('b@x.com', '鈴木'),
      r('c@x.com', '佐藤'),
    ];
    const attendedLineNames = new Set(['田中', '鈴木']);
    const result = svc.countByLpCr(optMap, reservations, attendedLineNames);
    expect(result.get('LP2-CR00500')).toEqual({
      reservationCount: 3,
      attendanceCount: 2,
    });
  });

  it('複数LP-CRに分散', () => {
    const optMap = new Map([
      ['a@x.com', { lpCr: 'LP2-CR00100', timestamp: new Date() }],
      ['b@x.com', { lpCr: 'LP2-CR00200', timestamp: new Date() }],
    ]);
    const reservations = [r('a@x.com', '田中'), r('b@x.com', '鈴木')];
    const attended = new Set(['田中']);
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
    const reservations = [r('a@x.com', '田中'), r('noopt@x.com', '未登録')];
    const result = svc.countByLpCr(optMap, reservations, new Set());
    expect(result.get('LP2-CR00500')!.reservationCount).toBe(1);
    expect(result.size).toBe(1);
  });

  it('LINE名にLINE名が無い予約者は着座なしでカウント', () => {
    const optMap = new Map([
      ['a@x.com', { lpCr: 'LP2-CR00500', timestamp: new Date() }],
    ]);
    const reservations = [r('a@x.com', '')];
    const attended = new Set(['田中']);
    const result = svc.countByLpCr(optMap, reservations, attended);
    expect(result.get('LP2-CR00500')).toEqual({
      reservationCount: 1,
      attendanceCount: 0,
    });
  });

  it('LINE名の前後空白はtrimして突合', () => {
    const optMap = new Map([
      ['a@x.com', { lpCr: 'LP2-CR00500', timestamp: new Date() }],
    ]);
    const reservations = [r('a@x.com', '  田中  ')];
    const attended = new Set(['田中']);
    const result = svc.countByLpCr(optMap, reservations, attended);
    expect(result.get('LP2-CR00500')!.attendanceCount).toBe(1);
  });

  it('空入力でも空Mapを返す', () => {
    const result = svc.countByLpCr(new Map(), [], new Set());
    expect(result.size).toBe(0);
  });

  it('LP-CRは大文字統一される', () => {
    const optMap = new Map([
      ['a@x.com', { lpCr: 'lp2-cr00500', timestamp: new Date() }],
    ]);
    const reservations = [r('a@x.com', '田中')];
    const result = svc.countByLpCr(optMap, reservations, new Set());
    expect(result.has('LP2-CR00500')).toBe(true);
    expect(result.has('lp2-cr00500')).toBe(false);
  });
});
