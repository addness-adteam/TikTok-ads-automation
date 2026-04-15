// ============================================================================
// 導線別ファネルモデル
// ============================================================================

import {
  ChannelType,
  FunnelModel,
  FunnelStage,
  ConversionRate,
  AI_SNS_STAGES,
  SKILL_PLUS_STAGES,
} from './types';

/** 導線タイプに応じたファネルステージ定義を返す */
export function getStageDefinition(
  channelType: ChannelType,
): readonly string[] {
  if (channelType === 'SKILL_PLUS') {
    return SKILL_PLUS_STAGES;
  }
  return AI_SNS_STAGES;
}

/** ステージ実績データからFunnelModelを構築する */
export function buildFunnelModel(
  channelType: ChannelType,
  stageMetrics: Record<string, number>,
  adSpend: number,
  totalRevenue: number,
): FunnelModel {
  const stageNames = getStageDefinition(channelType);

  const stages: FunnelStage[] = stageNames.map((name) => ({
    name,
    count: stageMetrics[name] ?? 0,
  }));

  return {
    channelType,
    stages,
    adSpend,
    totalRevenue,
  };
}

/** 隣接ステージ間の転換率を算出する */
export function calculateConversionRates(
  stages: FunnelStage[],
): ConversionRate[] {
  const rates: ConversionRate[] = [];

  for (let i = 0; i < stages.length - 1; i++) {
    const from = stages[i];
    const to = stages[i + 1];

    rates.push({
      fromStage: from.name,
      toStage: to.name,
      rate: from.count === 0 ? 0 : to.count / from.count,
    });
  }

  return rates;
}
