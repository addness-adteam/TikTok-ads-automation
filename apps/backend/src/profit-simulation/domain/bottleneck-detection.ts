// ============================================================================
// ボトルネック特定ロジック
// ============================================================================

import {
  ChannelType,
  KPITargets,
  BottleneckResult,
  AI_SNS_KPI_STAGE_MAP,
  SKILL_PLUS_KPI_STAGE_MAP,
} from './types';

/** KPI項目名→ファネルステージマッピングを取得 */
function getKpiStageMap(channelType: ChannelType): Record<string, [string, string]> {
  return channelType === 'SKILL_PLUS'
    ? SKILL_PLUS_KPI_STAGE_MAP
    : AI_SNS_KPI_STAGE_MAP;
}

/**
 * ボトルネックを特定する
 * 各KPI項目の現状転換率 vs 許容値を比較し、
 * 許容値を下回っているステージを粗利インパクト順にランキング
 */
export function detectBottlenecks(
  channelType: ChannelType,
  stageMetrics: Record<string, number>,
  kpiTargets: KPITargets,
): BottleneckResult[] {
  const kpiStageMap = getKpiStageMap(channelType);
  const bottlenecks: BottleneckResult[] = [];

  for (const [kpiName, targetRate] of Object.entries(kpiTargets.conversionRates)) {
    const stageMapping = kpiStageMap[kpiName];
    if (!stageMapping) continue;

    const [fromStage, toStage] = stageMapping;

    // 内部ステップ（fromとtoが同じ）はスキップ
    if (fromStage === toStage) continue;

    const fromCount = stageMetrics[fromStage];
    const toCount = stageMetrics[toStage];

    // 実績データがないステージはボトルネック対象から除外
    // （スプシにカラムがない等の理由でデータが取得できない場合）
    if (fromCount === undefined || toCount === undefined) continue;

    const currentRate = fromCount === 0 ? 0 : toCount / fromCount;

    // 許容値を上回っていればボトルネックではない
    if (currentRate >= targetRate) continue;

    const gapPoints = (currentRate - targetRate) * 100;

    // 粗利インパクト算出:
    // 「このステージをKPI通りに改善した場合、下流のCV数がどれだけ増えるか」
    // 増加分 = fromCount × (targetRate - currentRate)
    // 最終的な売上インパクト = 増加分 × 下流の転換率チェーン × 平均着金額
    const additionalCount = fromCount * (targetRate - currentRate);
    const downstreamRate = calculateDownstreamRate(
      channelType,
      toStage,
      stageMetrics,
      kpiTargets,
    );
    const profitImpact = Math.round(
      additionalCount * downstreamRate * kpiTargets.avgPaymentAmount,
    );

    bottlenecks.push({
      stage: kpiName,
      currentRate,
      targetRate,
      gapPoints: Math.round(gapPoints * 10) / 10,
      profitImpact,
      rank: 0, // 後でソートして振る
    });
  }

  // 粗利インパクト降順でソートし、ランク付け
  bottlenecks.sort((a, b) => b.profitImpact - a.profitImpact);
  bottlenecks.forEach((b, i) => {
    b.rank = i + 1;
  });

  return bottlenecks;
}

/**
 * 指定ステージから最終成約までの下流転換率を算出する
 * KPIの許容値をベースに、下流ステージの転換率を掛け合わせる
 */
function calculateDownstreamRate(
  channelType: ChannelType,
  fromStage: string,
  stageMetrics: Record<string, number>,
  kpiTargets: KPITargets,
): number {
  const kpiStageMap = getKpiStageMap(channelType);
  const stageOrder = getStageOrder(channelType);

  const fromIndex = stageOrder.indexOf(fromStage);
  if (fromIndex === -1) return 0;

  let rate = 1.0;

  // fromStageから下流のKPIマッピングを順に掛ける
  for (const [kpiName, [from, to]] of Object.entries(kpiStageMap)) {
    if (from === to) continue;

    const stageIdx = stageOrder.indexOf(from);
    if (stageIdx < fromIndex) continue;

    // 実績の転換率を使う。実績データがないステージはKPI許容値でフォールバック
    const fromCount = stageMetrics[from];
    const toCount = stageMetrics[to];

    let stageRate: number;
    if (fromCount === undefined || toCount === undefined || fromCount === 0) {
      // 実績なし → KPI許容値を使用
      stageRate = kpiTargets.conversionRates[kpiName] ?? 0;
    } else {
      stageRate = toCount / fromCount;
    }
    rate *= stageRate;
  }

  return rate;
}

/** 導線タイプに応じたステージ順序を返す */
function getStageOrder(channelType: ChannelType): string[] {
  if (channelType === 'SKILL_PLUS') {
    return [
      'オプトイン', 'LINE登録', 'セミナー予約',
      'セミナー着座', '個別予約', '個別着座', 'バックエンド購入',
    ];
  }
  return [
    'オプトイン', 'フロント購入', '秘密の部屋購入',
    'LINE登録', '個別予約', '個別着座', 'バックエンド購入',
  ];
}
