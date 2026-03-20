/**
 * ワンストップ出稿 定数定義
 */

// 広告文（導線別）
export const AD_TEXT: Record<string, string> = {
  'SNS': 'SNS副業するなら学んでおきたい本質のSNSマーケ特商法（https://skill.addness.co.jp/tokushoho）',
  'AI': 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）',
  'スキルプラス': '【大好評！】スキル習得セミナー AIは教えてくれない、会社に依存しない生き方です。',
};

// ターゲティング: 年齢25〜54歳
export const TARGET_AGE_GROUPS = ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'];

// 日予算デフォルト（導線別）
export const DEFAULT_BUDGET: Record<string, number> = {
  'AI': 3000,
  'SNS': 3000,
  'スキルプラス': 5000,
};

// アカウント→導線マッピング
export const ADVERTISER_APPEAL_MAP: Record<string, string> = {
  '7468288053866561553': 'AI',       // AI_1
  '7523128243466551303': 'AI',       // AI_2
  '7543540647266074641': 'AI',       // AI_3
  '7580666710525493255': 'AI',       // AI_4
  '7247073333517238273': 'SNS',      // SNS1
  '7543540100849156112': 'SNS',      // SNS2
  '7543540381615800337': 'SNS',      // SNS3
  '7474920444831875080': 'スキルプラス', // SP1
  '7592868952431362066': 'スキルプラス', // SP2
};
