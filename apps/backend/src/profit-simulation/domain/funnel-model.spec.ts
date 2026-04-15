import {
  buildFunnelModel,
  calculateConversionRates,
  getStageDefinition,
} from './funnel-model';
import { FunnelStage, ConversionRate } from './types';

describe('FunnelModel', () => {
  describe('getStageDefinition', () => {
    it('AI導線のステージ定義を返す', () => {
      const stages = getStageDefinition('AI');
      expect(stages[0]).toBe('インプレッション');
      expect(stages[2]).toBe('オプトイン');
      expect(stages[3]).toBe('フロント購入');
      expect(stages[stages.length - 1]).toBe('バックエンド購入');
    });

    it('SNS導線はAIと同じステージ定義', () => {
      const ai = getStageDefinition('AI');
      const sns = getStageDefinition('SNS');
      expect(sns).toEqual(ai);
    });

    it('スキルプラス導線はセミナー型ステージ定義', () => {
      const stages = getStageDefinition('SKILL_PLUS');
      expect(stages[0]).toBe('インプレッション');
      expect(stages[2]).toBe('オプトイン');
      expect(stages[3]).toBe('LINE登録');
      expect(stages[4]).toBe('セミナー予約');
      expect(stages[stages.length - 1]).toBe('バックエンド購入');
    });

    it('スキルプラスにはフロント購入ステージがない', () => {
      const stages = getStageDefinition('SKILL_PLUS');
      expect(stages).not.toContain('フロント購入');
      expect(stages).not.toContain('秘密の部屋購入');
    });
  });

  describe('buildFunnelModel', () => {
    it('ステージ実績からFunnelModelを構築する', () => {
      const stageMetrics: Record<string, number> = {
        インプレッション: 100000,
        クリック: 1000,
        オプトイン: 50,
        フロント購入: 5,
        秘密の部屋購入: 2,
        LINE登録: 3,
        個別予約: 4,
        個別着座: 3,
        バックエンド購入: 1,
      };

      const model = buildFunnelModel('AI', stageMetrics, 200000, 800000);

      expect(model.channelType).toBe('AI');
      expect(model.adSpend).toBe(200000);
      expect(model.totalRevenue).toBe(800000);
      expect(model.stages).toHaveLength(9);
      expect(model.stages[0]).toEqual({
        name: 'インプレッション',
        count: 100000,
      });
      expect(model.stages[2]).toEqual({ name: 'オプトイン', count: 50 });
    });

    it('存在しないステージは0件として扱う', () => {
      const stageMetrics: Record<string, number> = {
        インプレッション: 100000,
        クリック: 1000,
        オプトイン: 50,
      };

      const model = buildFunnelModel('AI', stageMetrics, 200000, 0);

      expect(model.stages.find((s) => s.name === 'フロント購入')?.count).toBe(
        0,
      );
      expect(
        model.stages.find((s) => s.name === 'バックエンド購入')?.count,
      ).toBe(0);
    });
  });

  describe('calculateConversionRates', () => {
    it('隣接ステージ間の転換率を算出する', () => {
      const stages: FunnelStage[] = [
        { name: 'クリック', count: 1000 },
        { name: 'オプトイン', count: 50 },
        { name: 'フロント購入', count: 10 },
      ];

      const rates = calculateConversionRates(stages);

      expect(rates).toHaveLength(2);
      expect(rates[0]).toEqual({
        fromStage: 'クリック',
        toStage: 'オプトイン',
        rate: 0.05,
      });
      expect(rates[1]).toEqual({
        fromStage: 'オプトイン',
        toStage: 'フロント購入',
        rate: 0.2,
      });
    });

    it('転換率が100%を超える場合も正しく算出する（フロント→個別率）', () => {
      const stages: FunnelStage[] = [
        { name: 'フロント購入', count: 5 },
        { name: '個別予約', count: 10 },
      ];

      const rates = calculateConversionRates(stages);

      expect(rates[0].rate).toBe(2.0);
    });

    it('転換元が0件の場合、転換率は0', () => {
      const stages: FunnelStage[] = [
        { name: 'クリック', count: 0 },
        { name: 'オプトイン', count: 0 },
      ];

      const rates = calculateConversionRates(stages);

      expect(rates[0].rate).toBe(0);
    });

    it('ステージが1つだけの場合、空配列を返す', () => {
      const stages: FunnelStage[] = [{ name: 'クリック', count: 1000 }];

      const rates = calculateConversionRates(stages);

      expect(rates).toHaveLength(0);
    });

    it('スキルプラスのリアルデータで転換率を算出', () => {
      const stages: FunnelStage[] = [
        { name: 'オプトイン', count: 191 },
        { name: 'LINE登録', count: 101 },
        { name: 'セミナー予約', count: 64 },
        { name: 'セミナー着座', count: 37 },
        { name: '個別予約', count: 25 },
      ];

      const rates = calculateConversionRates(stages);

      // オプト→LINE: 101/191 ≈ 0.529
      expect(rates[0].rate).toBeCloseTo(0.529, 2);
      // LINE→セミナー予約: 64/101 ≈ 0.634
      expect(rates[1].rate).toBeCloseTo(0.634, 2);
      // セミナー予約→着座: 37/64 ≈ 0.578
      expect(rates[2].rate).toBeCloseTo(0.578, 2);
      // 着座→個別予約: 25/37 ≈ 0.676
      expect(rates[3].rate).toBeCloseTo(0.676, 2);
    });
  });
});
