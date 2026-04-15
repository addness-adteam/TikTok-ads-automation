import { SheetsAttendanceLineNameReader } from './attendance-line-name-reader';

describe('SheetsAttendanceLineNameReader.parseRows', () => {
  const reader = new SheetsAttendanceLineNameReader({} as any);

  it('C列のLINE登録名を抽出、ヘッダー行はスキップ', () => {
    const rows = [
      ['ID', '表示名', 'LINE登録名', 'ウェビナー①_着座'],
      ['1', 'たなちゃん', '田中太郎', '○'],
      ['2', 'すず', '鈴木花子', '○'],
      ['3', 'sato', '佐藤一郎', '○'],
    ];
    const result = reader.parseRows(rows);
    expect(result.size).toBe(3);
    expect(result.has('田中太郎')).toBe(true);
    expect(result.has('鈴木花子')).toBe(true);
    expect(result.has('佐藤一郎')).toBe(true);
  });

  it('重複は排除', () => {
    const rows = [
      ['ID', '表示名', 'LINE登録名', 'タグ'],
      ['1', 'a', '田中', '○'],
      ['2', 'b', '田中', '○'],
      ['3', 'c', '鈴木', '○'],
    ];
    expect(reader.parseRows(rows).size).toBe(2);
  });

  it('C列が空ならスキップ', () => {
    const rows = [
      ['ID', '表示名', 'LINE登録名', 'タグ'],
      ['1', 'a', '田中', '○'],
      ['2', 'b', '', '○'],
      ['3', 'c', '鈴木', '○'],
    ];
    expect(reader.parseRows(rows).size).toBe(2);
  });

  it('前後の空白はtrim', () => {
    const rows = [
      ['ID', '表示名', 'LINE登録名', 'タグ'],
      ['1', 'a', '  田中  ', '○'],
      ['2', 'b', '田中', '○'],
    ];
    expect(reader.parseRows(rows).size).toBe(1);
  });
});
