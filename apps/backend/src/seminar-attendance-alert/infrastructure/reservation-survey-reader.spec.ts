import { SheetsReservationSurveyReader } from './reservation-survey-reader';

describe('SheetsReservationSurveyReader.parseRows', () => {
  const reader = new SheetsReservationSurveyReader({} as any);

  it('B列=日時, H列=メアド を取り出す', () => {
    const rows = [
      ['header'],
      ['', '2026/04/05 12:34:56', '', 'tanaka', '', '', '', 'foo@example.com'],
      ['', '2026/04/06 10:00:00', '', 'suzuki', '', '', '', 'BAR@Example.COM'],
    ];
    const result = reader.parseRows(rows);
    expect(result.length).toBe(2);
    expect(result[0].email).toBe('foo@example.com');
    expect(result[1].email).toBe('bar@example.com');
    expect(result[0].reservedAt.toISOString()).toBe('2026-04-05T03:34:56.000Z'); // JST→UTC
  });
  it('メアド空行/日付空行はskip', () => {
    const rows = [['header'],
      ['', '', '', '', '', '', '', 'only-email@x.com'],
      ['', '2026/04/06', '', '', '', '', '', ''],
    ];
    expect(reader.parseRows(rows).length).toBe(0);
  });
  it('@を含まない値は除外', () => {
    const rows = [['header'],
      ['', '2026/04/06 10:00:00', '', '', '', '', '', 'invalid-email'],
    ];
    expect(reader.parseRows(rows).length).toBe(0);
  });
});
