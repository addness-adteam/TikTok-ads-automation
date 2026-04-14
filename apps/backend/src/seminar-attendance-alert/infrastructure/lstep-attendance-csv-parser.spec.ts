import { LstepAttendanceCsvParser } from './lstep-attendance-csv-parser';

describe('LstepAttendanceCsvParser', () => {
  const parser = new LstepAttendanceCsvParser();

  it('メール列があれば抽出', () => {
    const csv = `ID,表示名,LINE登録名,メールアドレス
1,田中太郎,田中,foo@example.com
2,鈴木一郎,鈴木,BAR@example.COM`;
    const result = parser.parse(csv);
    expect(result.has('foo@example.com')).toBe(true);
    expect(result.has('bar@example.com')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('Eメールヘッダーも認識', () => {
    const csv = `ID,表示名,Eメール
1,田中,foo@x.com`;
    expect(parser.parse(csv).has('foo@x.com')).toBe(true);
  });

  it('ヘッダーに無ければ本文から正規表現で抽出', () => {
    const csv = `ID,表示名,何か
1,田中 <foo@x.com>,備考
2,鈴木,bar@y.com含むテキスト`;
    const result = parser.parse(csv);
    expect(result.has('foo@x.com')).toBe(true);
    expect(result.has('bar@y.com')).toBe(true);
  });

  it('空行を無視', () => {
    const csv = `ID,メール\n1,a@x.com\n\n\n2,b@x.com\n`;
    expect(parser.parse(csv).size).toBe(2);
  });

  it('ダブルクォートで囲まれた値も扱える', () => {
    const csv = `ID,"メールアドレス"\n1,"quoted@x.com"`;
    expect(parser.parse(csv).has('quoted@x.com')).toBe(true);
  });

  it('空入力で空Set', () => {
    expect(parser.parse('').size).toBe(0);
  });
});
