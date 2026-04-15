import { SheetsReservationSurveyReader } from './reservation-survey-reader';

describe('SheetsReservationSurveyReader.parseRows', () => {
  const reader = new SheetsReservationSurveyReader({} as any);

  it('B列=日時, D列=LINE名, H列=メアド を取り出す', () => {
    const rows = [
      ['header'],
      ['', '2026/04/05 12:34:56', '', '田中太郎', '', '', '', 'foo@example.com'],
      ['', '2026/04/06 10:00:00', '', '鈴木花子', '', '', '', 'BAR@Example.COM'],
    ];
    const result = reader.parseRows(rows);
    expect(result.length).toBe(2);
    expect(result[0].email).toBe('foo@example.com');
    expect(result[0].lineName).toBe('田中太郎');
    expect(result[1].email).toBe('bar@example.com');
    expect(result[1].lineName).toBe('鈴木花子');
    expect(result[0].reservedAt.toISOString()).toBe('2026-04-05T03:34:56.000Z');
  });
  it('メアド空行/日付空行はskip', () => {
    const rows = [
      ['header'],
      ['', '', '', '田中', '', '', '', 'only-email@x.com'],
      ['', '2026/04/06', '', '鈴木', '', '', '', ''],
    ];
    expect(reader.parseRows(rows).length).toBe(0);
  });
  it('@を含まない値は除外', () => {
    const rows = [
      ['header'],
      ['', '2026/04/06 10:00:00', '', '田中', '', '', '', 'invalid-email'],
    ];
    expect(reader.parseRows(rows).length).toBe(0);
  });
  it('LINE名未記入でも予約レコードは作る(空文字)', () => {
    const rows = [
      ['header'],
      ['', '2026/04/06 10:00:00', '', '', '', '', '', 'foo@x.com'],
    ];
    const result = reader.parseRows(rows);
    expect(result.length).toBe(1);
    expect(result[0].lineName).toBe('');
  });
});
