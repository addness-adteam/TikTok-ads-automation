import { AiSecretaryLineNotifier } from './line-notifier';

describe('AiSecretaryLineNotifier.formatMessage', () => {
  const notifier = new AiSecretaryLineNotifier();

  it('CPO_EXCEEDED の整形', () => {
    const msg = notifier.formatMessage({
      adName: '260404/横展開/CR454_横展開/LP2-CR00500',
      advertiserName: 'SP1',
      deliveryStartDate: new Date(Date.UTC(2026, 3, 7, 15)), // JST 2026/4/8 0:00
      deliveryDays: 6,
      totalSpend: 52000,
      reservationCount: 12,
      attendanceCount: 3,
      actualCpo: 17333,
      allowableCpo: 15000,
      reason: 'CPO_EXCEEDED',
    });
    expect(msg).toContain('⚠️ セミナー着座CPOアラート');
    expect(msg).toContain('260404/横展開/CR454_横展開/LP2-CR00500');
    expect(msg).toContain('SP1');
    expect(msg).toContain('4/8開始 (6日経過)');
    expect(msg).toContain('¥52,000');
    expect(msg).toContain('予約: 12件');
    expect(msg).toContain('着座: 3件');
    expect(msg).toContain('¥17,333');
    expect(msg).toContain('¥15,000');
    expect(msg).toContain('超過率 115.6%'); // 17333/15000 = 1.15553...
  });

  it('ZERO_ATTENDANCE_WITH_SPEND の整形', () => {
    const msg = notifier.formatMessage({
      adName: 'test ad',
      advertiserName: 'SP2',
      deliveryStartDate: new Date(Date.UTC(2026, 3, 1, 15)),
      deliveryDays: 7,
      totalSpend: 20000,
      reservationCount: 0,
      attendanceCount: 0,
      actualCpo: null,
      allowableCpo: 15000,
      reason: 'ZERO_ATTENDANCE_WITH_SPEND',
    });
    expect(msg).toContain('着座0件（算出不能）');
    expect(msg).toContain('1件も着座なし');
    expect(msg).toContain('¥15,000');
  });
});
