import { SheetsAttendanceLineNameReader } from './attendance-line-name-reader';

describe('SheetsAttendanceLineNameReader.parseRows', () => {
  const reader = new SheetsAttendanceLineNameReader({} as any);

  it('A列のLINE名を抽出、ヘッダー行はスキップ', () => {
    const rows = [['LINE名'], ['田中太郎'], ['鈴木花子'], ['佐藤一郎']];
    const result = reader.parseRows(rows);
    expect(result.size).toBe(3);
    expect(result.has('田中太郎')).toBe(true);
    expect(result.has('鈴木花子')).toBe(true);
    expect(result.has('佐藤一郎')).toBe(true);
  });

  it('重複は排除', () => {
    const rows = [['LINE名'], ['田中'], ['田中'], ['鈴木']];
    expect(reader.parseRows(rows).size).toBe(2);
  });

  it('空行はスキップ', () => {
    const rows = [['LINE名'], ['田中'], [''], ['鈴木'], [undefined as any]];
    expect(reader.parseRows(rows).size).toBe(2);
  });

  it('前後の空白はtrim', () => {
    const rows = [['LINE名'], ['  田中  '], ['田中']];
    expect(reader.parseRows(rows).size).toBe(1);
  });
});
