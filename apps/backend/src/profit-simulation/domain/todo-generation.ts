// ============================================================================
// TODO生成ロジック
// ============================================================================

import { v4 as uuidv4 } from 'uuid';
import {
  ChannelType,
  ImprovementDirection,
  BottleneckResult,
  GeneratedTodo,
  TodoActionType,
} from './types';
import { RuleStore, WinningCreativeSource } from './ports';

const AUTO_EXECUTABLE_TYPES: TodoActionType[] = [
  'CROSS_DEPLOY',
  'REDEPLOY',
  'BUDGET_CHANGE',
  'TARGETING_CHANGE',
];

const HIGH_IMPACT_THRESHOLD = 1_000_000;
const MEDIUM_IMPACT_THRESHOLD = 300_000;

/** ボトルネック + 改善方向からTODOを生成する */
export async function generateTodos(
  channelType: ChannelType,
  period: string,
  bottlenecks: BottleneckResult[],
  direction: ImprovementDirection,
  ruleStore: RuleStore,
  winningCreativeSource: WinningCreativeSource,
): Promise<GeneratedTodo[]> {
  if (direction === 'ON_TRACK') {
    return [];
  }

  // ルールをロード（将来的にフィルタリングに使用）
  const rules = await ruleStore.loadRules();

  const todos: GeneratedTodo[] = [];

  // 1. ボトルネックベースのTODO
  if (direction === 'IMPROVE_ROAS' || direction === 'BOTH') {
    for (const bottleneck of bottlenecks) {
      const bottleneckTodos = generateBottleneckTodos(
        channelType,
        period,
        bottleneck,
      );
      todos.push(...bottleneckTodos);
    }
  }

  // 2. 集客数増加のTODO
  if (direction === 'INCREASE_ACQUISITION' || direction === 'BOTH') {
    const acquisitionTodos = await generateAcquisitionTodos(
      channelType,
      period,
      winningCreativeSource,
    );
    todos.push(...acquisitionTodos);
  }

  return todos;
}

/** ボトルネック1件からTODOを生成 */
function generateBottleneckTodos(
  channelType: ChannelType,
  period: string,
  bottleneck: BottleneckResult,
): GeneratedTodo[] {
  const todos: GeneratedTodo[] = [];
  const priority = getPriority(bottleneck.profitImpact);

  // ステージ名に応じたTODO生成
  const stage = bottleneck.stage;

  if (stage === 'CPA' || stage.includes('CPA')) {
    // CPA高い → 調査（CPC確認含む）
    todos.push(
      createTodo(channelType, period, bottleneck, {
        action: `CPA改善: CPC¥100未満のCRがないか確認し、あれば停止検討。LP CVR改善も検討。`,
        actionType: 'INVESTIGATION',
        priority,
      }),
    );
  } else if (
    stage.includes('リストイン') ||
    stage.includes('メイン') ||
    stage.includes('LINE')
  ) {
    // リストイン率低下 → 導線確認 + CPC相関チェック
    todos.push(
      createTodo(channelType, period, bottleneck, {
        action: `リストイン率改善: サンクスページ→LINE登録導線の確認。CPC¥100未満のCRがないか確認。`,
        actionType: 'INVESTIGATION',
        priority,
      }),
    );
  } else if (stage.includes('セミナー予約') || stage.includes('企画')) {
    todos.push(
      createTodo(channelType, period, bottleneck, {
        action: `セミナー予約率改善: セミナー訴求の見直し。LINE配信内容の確認。`,
        actionType: 'FUNNEL_FIX',
        priority,
      }),
    );
  } else if (stage.includes('着座')) {
    todos.push(
      createTodo(channelType, period, bottleneck, {
        action: `着座率改善: リマインド配信の確認。セミナー日程・アクセス情報の改善。`,
        actionType: 'FUNNEL_FIX',
        priority,
      }),
    );
  } else if (stage.includes('成約')) {
    todos.push(
      createTodo(channelType, period, bottleneck, {
        action: `成約率改善: セールスプロセスの確認。価格・オファーの見直し。`,
        actionType: 'INVESTIGATION',
        priority,
      }),
    );
  } else if (stage.includes('フロント')) {
    todos.push(
      createTodo(channelType, period, bottleneck, {
        action: `フロント購入率改善: OTO/メルマガのオファー訴求見直し。LP→購入導線の確認。`,
        actionType: 'LP_IMPROVEMENT',
        priority,
      }),
    );
  } else if (
    stage.includes('個別') &&
    !stage.includes('着座') &&
    !stage.includes('成約')
  ) {
    todos.push(
      createTodo(channelType, period, bottleneck, {
        action: `個別予約率改善: LINE配信での個別相談訴求の見直し。予約導線の確認。`,
        actionType: 'FUNNEL_FIX',
        priority,
      }),
    );
  } else {
    // 汎用
    todos.push(
      createTodo(channelType, period, bottleneck, {
        action: `${stage}の改善: 現状${(bottleneck.currentRate * 100).toFixed(1)}% → 目標${(bottleneck.targetRate * 100).toFixed(1)}%。原因調査が必要。`,
        actionType: 'INVESTIGATION',
        priority,
      }),
    );
  }

  return todos;
}

/** 集客数増加のTODO生成 */
async function generateAcquisitionTodos(
  channelType: ChannelType,
  period: string,
  winningCreativeSource: WinningCreativeSource,
): Promise<GeneratedTodo[]> {
  const todos: GeneratedTodo[] = [];
  const hasWinners =
    await winningCreativeSource.hasWinningCreatives(channelType);

  if (hasWinners) {
    const winners =
      await winningCreativeSource.getWinningCreatives(channelType);
    todos.push({
      id: uuidv4(),
      channelType,
      period,
      bottleneckStage: '集客数不足',
      currentRate: 0,
      targetRate: 0,
      gapPoints: 0,
      profitImpact: 0,
      action: `勝ちCR(${winners.length}本)の横展開を実行。候補: ${winners
        .slice(0, 3)
        .map((w) => w.adName)
        .join(', ')}`,
      actionType: 'CROSS_DEPLOY',
      isAutoExecutable: true,
      priority: 'HIGH',
      status: 'PENDING',
    });

    todos.push({
      id: uuidv4(),
      channelType,
      period,
      bottleneckStage: '集客数不足',
      currentRate: 0,
      targetRate: 0,
      gapPoints: 0,
      profitImpact: 0,
      action: `勝ちCRの再出稿を検討。停止中の実績CRから再出稿候補を選定。`,
      actionType: 'REDEPLOY',
      isAutoExecutable: true,
      priority: 'MEDIUM',
      status: 'PENDING',
    });
  } else {
    todos.push({
      id: uuidv4(),
      channelType,
      period,
      bottleneckStage: '集客数不足',
      currentRate: 0,
      targetRate: 0,
      gapPoints: 0,
      profitImpact: 0,
      action: `勝ちCRがないため、新規クリエイティブの制作を依頼。`,
      actionType: 'CREATIVE_REQUEST',
      isAutoExecutable: false,
      priority: 'HIGH',
      status: 'PENDING',
    });
  }

  return todos;
}

function createTodo(
  channelType: ChannelType,
  period: string,
  bottleneck: BottleneckResult,
  opts: {
    action: string;
    actionType: TodoActionType;
    priority: GeneratedTodo['priority'];
  },
): GeneratedTodo {
  return {
    id: uuidv4(),
    channelType,
    period,
    bottleneckStage: bottleneck.stage,
    currentRate: bottleneck.currentRate,
    targetRate: bottleneck.targetRate,
    gapPoints: bottleneck.gapPoints,
    profitImpact: bottleneck.profitImpact,
    action: opts.action,
    actionType: opts.actionType,
    isAutoExecutable: AUTO_EXECUTABLE_TYPES.includes(opts.actionType),
    priority: opts.priority,
    status: 'PENDING',
  };
}

function getPriority(profitImpact: number): GeneratedTodo['priority'] {
  if (profitImpact >= HIGH_IMPACT_THRESHOLD) return 'HIGH';
  if (profitImpact >= MEDIUM_IMPACT_THRESHOLD) return 'MEDIUM';
  return 'LOW';
}
