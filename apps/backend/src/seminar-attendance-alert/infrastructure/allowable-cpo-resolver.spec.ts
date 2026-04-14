import { SheetsAllowableCpoResolver } from './allowable-cpo-resolver';
import { YearMonth } from '../domain/value-objects/allowable-seminar-seat-cpo';

describe('SheetsAllowableCpoResolver.extractFromRows', () => {
  const resolver = new SheetsAllowableCpoResolver({} as any);

  it('「許容セミナー着座CPO」ラベル+値を抽出 (2025/11 パターン)', () => {
    // row 0-1: ヘッダー、row 67: 月開始、row 77: "許容セミナー着座CPO" col35
    const rows: string[][] = Array(80).fill(null).map(() => []);
    rows[67] = ['2025/11/1'];
    rows[77] = [];
    rows[77][33] = '¥218,887';
    rows[77][35] = '許容セミナー着座CPO';
    rows[77][36] = '7,875';

    const result = resolver.extractFromRows(rows, YearMonth.of(2025, 11));
    expect(result).not.toBeNull();
    expect(result!.amount.amount).toBe(7875);
    expect(result!.month.toString()).toBe('2025-11');
  });

  it('「セミナー着座CPO」ラベル+値を抽出 (2026/4 パターン・"許容"抜き)', () => {
    const rows: string[][] = Array(250).fill(null).map(() => []);
    rows[228] = ['2026/4/1'];
    rows[242] = [];
    rows[242][36] = 'セミナー着座CPO';
    rows[242][37] = '¥30,060';

    const result = resolver.extractFromRows(rows, YearMonth.of(2026, 4));
    expect(result).not.toBeNull();
    expect(result!.amount.amount).toBe(30060);
  });

  it('該当月ブロックがない場合はnull', () => {
    const rows: string[][] = [['2025/9/1']];
    const result = resolver.extractFromRows(rows, YearMonth.of(2030, 12));
    expect(result).toBeNull();
  });

  it('ラベルはあるが値が空の場合はnull', () => {
    const rows: string[][] = Array(20).fill(null).map(() => []);
    rows[3] = ['2026/4/1'];
    rows[10] = [];
    rows[10][36] = '許容セミナー着座CPO';
    rows[10][37] = '';

    const result = resolver.extractFromRows(rows, YearMonth.of(2026, 4));
    expect(result).toBeNull();
  });

  it('A列の"項目"ヘッダー(row 1)のセミナー着座CPOは月ブロック外なので無視', () => {
    const rows: string[][] = Array(50).fill(null).map(() => []);
    rows[1] = [];
    rows[1][19] = 'セミナー着座CPO'; // ヘッダー行のラベル
    rows[1][20] = '¥99,999'; // ダミー値
    // 月ブロックなし
    const result = resolver.extractFromRows(rows, YearMonth.of(2026, 4));
    expect(result).toBeNull();
  });

  it('2月(数字1桁)の月ブロックも正しくマッチ', () => {
    const rows: string[][] = Array(200).fill(null).map(() => []);
    rows[165] = ['2026/2/1'];
    rows[177] = [];
    rows[177][36] = 'セミナー着座CPO';
    rows[177][37] = '¥12,521';
    const result = resolver.extractFromRows(rows, YearMonth.of(2026, 2));
    expect(result).not.toBeNull();
    expect(result!.amount.amount).toBe(12521);
  });

  it('「許容」付きがあればそれを優先（通常ラベルは無視）', () => {
    const rows: string[][] = Array(50).fill(null).map(() => []);
    rows[10] = ['2026/4/1'];
    rows[20] = [];
    rows[20][10] = 'セミナー着座CPO';
    rows[20][11] = '¥99,999'; // 実績側
    rows[20][20] = '許容セミナー着座CPO';
    rows[20][21] = '¥15,000'; // 許容側
    const result = resolver.extractFromRows(rows, YearMonth.of(2026, 4));
    expect(result!.amount.amount).toBe(15000);
  });
});
