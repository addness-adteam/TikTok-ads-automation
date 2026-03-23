// ============================================================================
// 変数の洗い出し
// ============================================================================

import { ChannelType, ImprovementDirection } from './types';

const ROAS_VARIABLES_AI_SNS = [
  'CPA',
  'LP CVR（クリック→オプト）',
  'オプト→フロント購入率',
  'フロント→秘密の部屋購入率',
  'LINE登録率',
  '個別予約率',
  '個別着座率',
  '個別着座→成約率',
];

const ROAS_VARIABLES_SKILL_PLUS = [
  'CPA',
  'LP CVR（クリック→オプト）',
  'オプト→リストイン率',
  'リストイン→セミナー予約率',
  'セミナー予約→着座率',
  '着座→個別予約率',
  '個別予約→着座率',
  '個別着座→成約率',
];

const ACQUISITION_VARIABLES = [
  '広告費（日予算）',
  'CPC',
  'LP CVR',
  '配信CR数',
  'アカウント数',
];

/** 改善方向×導線に応じて操作可能な変数を列挙する */
export function identifyVariables(
  channelType: ChannelType,
  direction: ImprovementDirection,
): string[] {
  if (direction === 'ON_TRACK') {
    return [];
  }

  const roasVars = channelType === 'SKILL_PLUS'
    ? ROAS_VARIABLES_SKILL_PLUS
    : ROAS_VARIABLES_AI_SNS;

  switch (direction) {
    case 'IMPROVE_ROAS':
      return [...roasVars];
    case 'INCREASE_ACQUISITION':
      return [...ACQUISITION_VARIABLES];
    case 'BOTH':
      return [...roasVars, ...ACQUISITION_VARIABLES];
  }
}
