/**
 * 横展開機能 型定義
 */

export type DeployMode = 'SMART_PLUS' | 'REGULAR';

export class CrossDeployInput {
  sourceAdvertiserId: string; // 元アカウントのTikTok advertiser_id
  sourceAdId: string; // 元広告ID
  targetAdvertiserIds: string[]; // 横展開先アカウント（複数可）
  mode: DeployMode; // 'SMART_PLUS' or 'REGULAR'
  adNameOverride?: string; // 広告名を上書きする場合
  dailyBudget?: number; // 日予算（デフォルト: 導線別）
  videoIndices?: number[]; // REGULAR時: Smart+の何番目の動画を使うか（省略で全部）
  dryRun?: boolean; // true: 動画アップロードまで実行、広告作成はスキップ
}

export interface CrossDeployResult {
  targetAdvertiserId: string;
  status: 'SUCCESS' | 'FAILED';
  mode: DeployMode;
  campaignId?: string;
  adgroupId?: string;
  adId?: string;
  adName?: string;
  utagePath?: string;
  destinationUrl?: string;
  crNumber?: number;
  dailyBudget?: number;
  videoMapping?: Record<string, string>; // 元video_id → 新video_id
  error?: string;
  failedStep?: string;
}

export interface PreviewResult {
  sourceAdvertiserId: string;
  sourceAdId: string;
  adName: string;
  adFormat: string;
  videoCount: number;
  videoIds: string[];
  imageCount: number;
  imageIds: string[];
  adTexts: string[];
  landingPageUrls: string[];
  adConfiguration: any;
}
