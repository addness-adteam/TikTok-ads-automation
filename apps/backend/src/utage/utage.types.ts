/**
 * UTAGE連携 型定義・定数
 * TikTok広告用のファネルマッピング
 */

export interface FunnelConfig {
  funnelId: string;
  groupId: string;
  stepId: string;
}

export interface RegistrationPathResult {
  registrationPath: string;
  destinationUrl: string;
  crNumber: number;
}

// TikTok広告用ファネル定義（Meta広告とは別ID）
export const TIKTOK_FUNNEL_DEFINITIONS = [
  { funnelId: 'a09j9jop95LF', appeal: 'AI' },
  { funnelId: 'dZNDzwCgHNBC', appeal: 'SNS' },
  { funnelId: '3lS3x3dXa6kc', appeal: 'スキルプラス' }, // セミナー導線
  { funnelId: 'EYHSSYtextak', appeal: 'スキルプラス' }, // LP1
];

// TikTok広告用ファネルマッピング（確定値）
export const TIKTOK_FUNNEL_MAP: Record<string, Record<number, FunnelConfig>> = {
  'AI': {
    1: { funnelId: 'a09j9jop95LF', groupId: 'EFnsGw3gAdba', stepId: 'r2RHcL0PdGIY' },
    2: { funnelId: 'a09j9jop95LF', groupId: 'bvnhWMTjQAPU', stepId: 'EnFeDysozIui' },
    3: { funnelId: 'a09j9jop95LF', groupId: 'EZL6dqvMuop6', stepId: 'A65xiRBl9HCD' },
    4: { funnelId: 'a09j9jop95LF', groupId: 'hEwR9BcvprDu', stepId: 'T8RHcXJVzGtY' },
    5: { funnelId: 'a09j9jop95LF', groupId: 'ND7cXzKmeiqG', stepId: 'EIQBI7HAVxgd' },
    6: { funnelId: 'a09j9jop95LF', groupId: 'FNFK0iB3rIzl', stepId: 'U8Ba9qy5m0us' },
  },
  'SNS': {
    1: { funnelId: 'dZNDzwCgHNBC', groupId: '32FwkcHtFSuj', stepId: 'wZhilaQY1Huv' },
    2: { funnelId: 'dZNDzwCgHNBC', groupId: 'dLrB2E7U7tq8', stepId: 'AhTvtpaeXyj6' },
    3: { funnelId: 'dZNDzwCgHNBC', groupId: 'L9JO3krgnNYD', stepId: '5UKZIXOKSyV4' },
    4: { funnelId: 'dZNDzwCgHNBC', groupId: 'JBy6Obcrng4Z', stepId: 'IxX853OXYhz2' },
  },
  'スキルプラス': {
    2: { funnelId: '3lS3x3dXa6kc', groupId: 'sOiiROJBAVIu', stepId: 'doc7hffUAVTv' },
  },
};

// UTAGE定数
export const OPERATOR_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
export const UTAGE_BASE_URL = 'https://school.addness.co.jp';

// デフォルト日予算（導線別）
export const DEFAULT_DAILY_BUDGET: Record<string, number> = {
  'AI': 3000,
  'SNS': 3000,
  'スキルプラス': 5000,
};

// ディープファネル最適化設定（導線別）
// AI導線: 登録最適化(ON_WEB_REGISTER) + 購入到達を加味(COMPLETE_PAYMENT)の二段階最適化
export const DEEP_FUNNEL_CONFIG: Record<string, { deepExternalAction: string } | undefined> = {
  'AI': { deepExternalAction: 'COMPLETE_PAYMENT' },
};
