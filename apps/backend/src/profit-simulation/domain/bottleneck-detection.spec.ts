import { detectBottlenecks } from './bottleneck-detection';
import { FunnelStage, KPITargets } from './types';

describe('BottleneckDetection', () => {
  describe('detectBottlenecks', () => {
    it('スキルプラスのリアルデータでボトルネックを特定する', () => {
      const stageMetrics: Record<string, number> = {
        'オプトイン': 191,
        'LINE登録': 101,
        'セミナー予約': 64,
        'セミナー着座': 37,
        '個別予約': 25,
        '個別着座': 15,
        'バックエンド購入': 11,
      };

      const kpiTargets: KPITargets = {
        conversionRates: {
          'オプト→メイン': 0.7613,
          'メイン→企画': 0.6295,
          'セミナー予約→セミナー着座率': 0.5565,
          'セミナー着座→個別予約率': 0.6156,
          '個別予約→個別着座率': 0.604,
          '個別着座→成約率': 0.3613,
        },
        targetROAS: 3.0,
        avgPaymentAmount: 671_274,
        cpa: 6_013,
      };

      const results = detectBottlenecks('SKILL_PLUS', stageMetrics, kpiTargets);

      expect(results.length).toBeGreaterThan(0);
      // rank=1が最大の粗利インパクト
      expect(results[0].rank).toBe(1);

      // オプト→リストイン率が最大のボトルネック（52.9% vs KPI 76.13%）
      const listInBottleneck = results.find(r => r.stage === 'オプト→メイン');
      expect(listInBottleneck).toBeDefined();
      expect(listInBottleneck!.currentRate).toBeCloseTo(0.529, 2);
      expect(listInBottleneck!.targetRate).toBe(0.7613);
      expect(listInBottleneck!.gapPoints).toBeCloseTo(-23.2, 0);
    });

    it('KPI許容値を上回っているステージはボトルネックにならない', () => {
      const stageMetrics: Record<string, number> = {
        'オプトイン': 100,
        'LINE登録': 80,   // 80% > KPI 76.13%
        'セミナー予約': 60, // 75% > KPI 62.95%
      };

      const kpiTargets: KPITargets = {
        conversionRates: {
          'オプト→メイン': 0.7613,
          'メイン→企画': 0.6295,
        },
        targetROAS: 3.0,
        avgPaymentAmount: 671_274,
        cpa: 6_013,
      };

      const results = detectBottlenecks('SKILL_PLUS', stageMetrics, kpiTargets);

      // 全ステージがKPI超えなので空
      expect(results).toHaveLength(0);
    });

    it('AI/SNS導線のKPIマッピングでボトルネック検出', () => {
      const stageMetrics: Record<string, number> = {
        'オプトイン': 797,
        'フロント購入': 60,
        '個別予約': 57,
        '個別着座': 30,
        'バックエンド購入': 10,
      };

      const kpiTargets: KPITargets = {
        conversionRates: {
          'オプト→フロント率': 0.0588,
          'フロント→個別率': 2.0,
          '個別→着座率': 0.58,
          '着座→成約率': 0.38,
        },
        targetROAS: 3.0,
        avgPaymentAmount: 732_236,
        cpa: 3_024,
      };

      const results = detectBottlenecks('AI', stageMetrics, kpiTargets);

      // オプト→フロント率: 60/797=0.0753 > KPI 0.0588 → OK
      // フロント→個別率: 57/60=0.95 < KPI 2.0 → ボトルネック
      // 個別→着座率: 30/57=0.526 < KPI 0.58 → ボトルネック
      // 着座→成約率: 10/30=0.333 < KPI 0.38 → ボトルネック
      expect(results.length).toBe(3);

      const frontToIndividual = results.find(r => r.stage === 'フロント→個別率');
      expect(frontToIndividual).toBeDefined();
    });

    it('粗利インパクト順にランキングされる', () => {
      const stageMetrics: Record<string, number> = {
        'オプトイン': 191,
        'LINE登録': 101,
        'セミナー予約': 30,   // 低い
        'セミナー着座': 15,
        '個別予約': 5,
        '個別着座': 3,
        'バックエンド購入': 1,
      };

      const kpiTargets: KPITargets = {
        conversionRates: {
          'オプト→メイン': 0.7613,
          'メイン→企画': 0.6295,
          'セミナー予約→セミナー着座率': 0.5565,
          'セミナー着座→個別予約率': 0.6156,
          '個別予約→個別着座率': 0.604,
          '個別着座→成約率': 0.3613,
        },
        targetROAS: 3.0,
        avgPaymentAmount: 671_274,
        cpa: 6_013,
      };

      const results = detectBottlenecks('SKILL_PLUS', stageMetrics, kpiTargets);

      // ランクが1,2,3...と連番
      for (let i = 0; i < results.length; i++) {
        expect(results[i].rank).toBe(i + 1);
      }

      // 粗利インパクトが降順
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].profitImpact).toBeGreaterThanOrEqual(results[i].profitImpact);
      }
    });

    it('ステージ実績が0件の場合も正しく処理する', () => {
      const stageMetrics: Record<string, number> = {
        'オプトイン': 0,
        'LINE登録': 0,
      };

      const kpiTargets: KPITargets = {
        conversionRates: {
          'オプト→メイン': 0.7613,
        },
        targetROAS: 3.0,
        avgPaymentAmount: 671_274,
        cpa: 6_013,
      };

      const results = detectBottlenecks('SKILL_PLUS', stageMetrics, kpiTargets);

      // 0/0の場合、currentRate=0でKPI未達→ボトルネック
      // ただし粗利インパクトは0（改善してもオプト0件なので意味がない）
      expect(results).toHaveLength(1);
      expect(results[0].currentRate).toBe(0);
      expect(results[0].profitImpact).toBe(0);
    });

    it('実績データがないステージ（undefined）はボトルネック対象から除外', () => {
      // AI/SNSの「個別着座」はスプシにカラムがないためundefined
      const stageMetrics: Record<string, number> = {
        'オプトイン': 797,
        'フロント購入': 60,
        '個別予約': 57,
        // '個別着座' は存在しない（undefined）
        // 'バックエンド購入' も存在しない
      };

      const kpiTargets: KPITargets = {
        conversionRates: {
          'オプト→フロント率': 0.0588,
          'フロント→個別率': 2.0,
          '個別→着座率': 0.58,
          '着座→成約率': 0.38,
        },
        targetROAS: 3.0,
        avgPaymentAmount: 732_236,
        cpa: 3_024,
      };

      const results = detectBottlenecks('AI', stageMetrics, kpiTargets);

      // 個別→着座率、着座→成約率は実績データなしのため除外
      const stageNames = results.map(r => r.stage);
      expect(stageNames).not.toContain('個別→着座率');
      expect(stageNames).not.toContain('着座→成約率');

      // フロント→個別率は両方のステージが存在するのでボトルネック対象
      expect(stageNames).toContain('フロント→個別率');
    });

    it('粗利インパクトがKPIフォールバックで正しく算出される', () => {
      const stageMetrics: Record<string, number> = {
        'オプトイン': 191,
        'LINE登録': 101,
        'セミナー予約': 64,
        'セミナー着座': 37,
        '個別予約': 25,
        // 個別着座・バックエンド購入のデータなし
      };

      const kpiTargets: KPITargets = {
        conversionRates: {
          'オプト→メイン': 0.7613,
          'メイン→企画': 0.6295,
          'セミナー予約→セミナー着座率': 0.5565,
          'セミナー着座→個別予約率': 0.6156,
          '個別予約→個別着座率': 0.604,
          '個別着座→成約率': 0.3613,
        },
        targetROAS: 3.0,
        avgPaymentAmount: 671_274,
        cpa: 6_013,
      };

      const results = detectBottlenecks('SKILL_PLUS', stageMetrics, kpiTargets);

      // オプト→メインが最大ボトルネック
      const listIn = results.find(r => r.stage === 'オプト→メイン');
      expect(listIn).toBeDefined();
      // 粗利インパクトが0ではなく、KPIフォールバックで計算されている
      expect(listIn!.profitImpact).toBeGreaterThan(0);
    });
  });
});
