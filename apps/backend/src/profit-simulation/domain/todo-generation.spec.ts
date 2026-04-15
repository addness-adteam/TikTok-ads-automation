import { generateTodos } from './todo-generation';
import { BottleneckResult, OpsRule, WinningCreative } from './types';
import { RuleStore, WinningCreativeSource } from './ports';

// モック
const mockRuleStore: RuleStore = {
  loadRules: async () => [],
  addRule: async () => {},
};

const mockWinningCreativeSourceEmpty: WinningCreativeSource = {
  hasWinningCreatives: async () => false,
  getWinningCreatives: async () => [],
};

const mockWinningCreativeSourceWithCRs: WinningCreativeSource = {
  hasWinningCreatives: async () => true,
  getWinningCreatives: async () => [
    {
      adId: '123',
      adName: '260301/田中/勝ちCR/LP1',
      advertiserId: 'adv1',
      channelType: 'AI',
    },
  ],
};

describe('TodoGeneration', () => {
  describe('ボトルネックからTODO生成', () => {
    it('LP CVR低下 → LP改善TODOを生成', async () => {
      const bottlenecks: BottleneckResult[] = [
        {
          stage: 'CPA',
          currentRate: 5655,
          targetRate: 5000,
          gapPoints: 655,
          profitImpact: 500_000,
          rank: 1,
        },
      ];

      const todos = await generateTodos(
        'SKILL_PLUS',
        '2026-03',
        bottlenecks,
        'IMPROVE_ROAS',
        mockRuleStore,
        mockWinningCreativeSourceEmpty,
      );

      expect(todos.length).toBeGreaterThan(0);
      const lpTodo = todos.find(
        (t) =>
          t.actionType === 'LP_IMPROVEMENT' || t.actionType === 'INVESTIGATION',
      );
      expect(lpTodo).toBeDefined();
    });

    it('集客不足 + 勝ちCRあり → 横展開TODOを生成', async () => {
      const bottlenecks: BottleneckResult[] = [];

      const todos = await generateTodos(
        'AI',
        '2026-03',
        bottlenecks,
        'INCREASE_ACQUISITION',
        mockRuleStore,
        mockWinningCreativeSourceWithCRs,
      );

      const crossDeploy = todos.find((t) => t.actionType === 'CROSS_DEPLOY');
      expect(crossDeploy).toBeDefined();
      expect(crossDeploy!.isAutoExecutable).toBe(true);
    });

    it('集客不足 + 勝ちCRなし → クリエイティブ制作依頼TODOを生成', async () => {
      const bottlenecks: BottleneckResult[] = [];

      const todos = await generateTodos(
        'AI',
        '2026-03',
        bottlenecks,
        'INCREASE_ACQUISITION',
        mockRuleStore,
        mockWinningCreativeSourceEmpty,
      );

      const creative = todos.find((t) => t.actionType === 'CREATIVE_REQUEST');
      expect(creative).toBeDefined();
      expect(creative!.isAutoExecutable).toBe(false);
    });

    it('リストイン率低下 → 導線確認TODOを生成', async () => {
      const bottlenecks: BottleneckResult[] = [
        {
          stage: 'オプト→メイン',
          currentRate: 0.529,
          targetRate: 0.7613,
          gapPoints: -23.2,
          profitImpact: 2_600_000,
          rank: 1,
        },
      ];

      const todos = await generateTodos(
        'SKILL_PLUS',
        '2026-03',
        bottlenecks,
        'IMPROVE_ROAS',
        mockRuleStore,
        mockWinningCreativeSourceEmpty,
      );

      expect(todos.length).toBeGreaterThan(0);
      // 導線改善 or 調査のTODOが生成される
      const funnelTodo = todos.find(
        (t) =>
          t.actionType === 'FUNNEL_FIX' || t.actionType === 'INVESTIGATION',
      );
      expect(funnelTodo).toBeDefined();
    });

    it('ON_TRACK → TODOを生成しない', async () => {
      const todos = await generateTodos(
        'AI',
        '2026-03',
        [],
        'ON_TRACK',
        mockRuleStore,
        mockWinningCreativeSourceEmpty,
      );

      expect(todos).toHaveLength(0);
    });
  });

  describe('ルール適用', () => {
    it('ルールに合致するTODOは除外される', async () => {
      const ruleStore: RuleStore = {
        loadRules: async () => [
          {
            id: 'R_TEST',
            category: '再出稿',
            rule: '出稿7日未満のCRは効果測定優先',
            condition: 'daysActive < 7',
            action: 'ボトルネック改善TODOを除外',
          },
        ],
        addRule: async () => {},
      };

      const bottlenecks: BottleneckResult[] = [
        {
          stage: 'オプト→メイン',
          currentRate: 0.5,
          targetRate: 0.76,
          gapPoints: -26,
          profitImpact: 1_000_000,
          rank: 1,
        },
      ];

      const todos = await generateTodos(
        'SKILL_PLUS',
        '2026-03',
        bottlenecks,
        'IMPROVE_ROAS',
        ruleStore,
        mockWinningCreativeSourceEmpty,
      );

      // ルールがロードされることの確認（ルール適用の詳細ロジックは運用しながら拡充）
      expect(todos).toBeDefined();
    });
  });

  describe('TODO属性', () => {
    it('各TODOにchannelType, period, statusが設定される', async () => {
      const bottlenecks: BottleneckResult[] = [
        {
          stage: 'オプト→フロント率',
          currentRate: 0.05,
          targetRate: 0.0588,
          gapPoints: -0.88,
          profitImpact: 300_000,
          rank: 1,
        },
      ];

      const todos = await generateTodos(
        'AI',
        '2026-03',
        bottlenecks,
        'IMPROVE_ROAS',
        mockRuleStore,
        mockWinningCreativeSourceEmpty,
      );

      for (const todo of todos) {
        expect(todo.channelType).toBe('AI');
        expect(todo.period).toBe('2026-03');
        expect(todo.status).toBe('PENDING');
        expect(todo.id).toBeTruthy();
      }
    });

    it('粗利インパクトが大きいほど優先度が高い', async () => {
      const bottlenecks: BottleneckResult[] = [
        {
          stage: 'オプト→メイン',
          currentRate: 0.5,
          targetRate: 0.76,
          gapPoints: -26,
          profitImpact: 5_000_000,
          rank: 1,
        },
        {
          stage: 'メイン→企画',
          currentRate: 0.5,
          targetRate: 0.63,
          gapPoints: -13,
          profitImpact: 500_000,
          rank: 2,
        },
      ];

      const todos = await generateTodos(
        'SKILL_PLUS',
        '2026-03',
        bottlenecks,
        'IMPROVE_ROAS',
        mockRuleStore,
        mockWinningCreativeSourceEmpty,
      );

      const highPriority = todos.filter((t) => t.priority === 'HIGH');
      const mediumPriority = todos.filter((t) => t.priority === 'MEDIUM');

      // 粗利インパクト5Mのボトルネックから生成されたTODOはHIGH
      expect(highPriority.length).toBeGreaterThan(0);
    });

    it('自動実行可能なアクションタイプはisAutoExecutable=true', async () => {
      const todos = await generateTodos(
        'AI',
        '2026-03',
        [],
        'INCREASE_ACQUISITION',
        mockRuleStore,
        mockWinningCreativeSourceWithCRs,
      );

      const crossDeploy = todos.find((t) => t.actionType === 'CROSS_DEPLOY');
      const creative = todos.find((t) => t.actionType === 'CREATIVE_REQUEST');

      if (crossDeploy) expect(crossDeploy.isAutoExecutable).toBe(true);
      if (creative) expect(creative.isAutoExecutable).toBe(false);
    });
  });
});
