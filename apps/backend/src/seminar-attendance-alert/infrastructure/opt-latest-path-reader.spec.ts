import { SheetsOptLatestPathReader } from './opt-latest-path-reader';

const header = ['名前', 'メールアドレス', '電話番号', '登録元ページURL', 'ファネル登録経路', 'アクション実行日時'];

describe('SheetsOptLatestPathReader.buildLatestMap', () => {
  const reader = new SheetsOptLatestPathReader({} as any);

  it('ファネル登録経路からLP-CR抽出', () => {
    const rows = [header,
      ['田中', 'foo@example.com', '', 'https://x/p/a?ftid=1', 'TikTok広告-スキルプラス-LP2-CR00500', '2026-04-01 10:00:00'],
    ];
    const map = reader.buildLatestMap(rows);
    expect(map.get('foo@example.com')?.lpCr).toBe('LP2-CR00500');
  });

  it('ファネル登録経路空でもURLから抽出', () => {
    const rows = [header,
      ['', 'bar@example.com', '', 'https://x/p/a?utm_campaign=260404%2F%E6%A8%AA%E5%B1%95%E9%96%8B%2FCR454_%E6%A8%AA%E5%B1%95%E9%96%8B%2FLP1-CR01147', '', '2026-04-01 10:00:00'],
    ];
    const map = reader.buildLatestMap(rows);
    expect(map.get('bar@example.com')?.lpCr).toBe('LP1-CR01147');
  });

  it('同メアドで複数行 → 最新のLP-CRを採用', () => {
    const rows = [header,
      ['', 'x@example.com', '', '', 'TikTok広告-スキルプラス-LP2-CR00100', '2026-04-01 10:00:00'],
      ['', 'x@example.com', '', '', 'TikTok広告-スキルプラス-LP2-CR00200', '2026-04-03 15:30:00'],
      ['', 'x@example.com', '', '', 'TikTok広告-スキルプラス-LP2-CR00150', '2026-04-02 12:00:00'],
    ];
    const map = reader.buildLatestMap(rows);
    expect(map.get('x@example.com')?.lpCr).toBe('LP2-CR00200');
  });

  it('LP-CRが取れない行は除外', () => {
    const rows = [header,
      ['', 'y@example.com', '', 'https://noise.com', '', '2026-04-01'],
    ];
    const map = reader.buildLatestMap(rows);
    expect(map.get('y@example.com')).toBeUndefined();
  });

  it('メアド空行は除外', () => {
    const rows = [header,
      ['', '', '', '', 'TikTok広告-スキルプラス-LP2-CR00100', '2026-04-01'],
    ];
    const map = reader.buildLatestMap(rows);
    expect(map.size).toBe(0);
  });

  it('メアドは小文字化・前後空白除去で正規化', () => {
    const rows = [header,
      ['', '  FOO@Example.COM ', '', '', 'TikTok広告-スキルプラス-LP2-CR00100', '2026-04-01 10:00:00'],
    ];
    const map = reader.buildLatestMap(rows);
    expect(map.has('foo@example.com')).toBe(true);
  });

  it('日時不正行は除外', () => {
    const rows = [header,
      ['', 'z@example.com', '', '', 'TikTok広告-スキルプラス-LP2-CR00100', 'invalid-date'],
    ];
    const map = reader.buildLatestMap(rows);
    expect(map.size).toBe(0);
  });
});
