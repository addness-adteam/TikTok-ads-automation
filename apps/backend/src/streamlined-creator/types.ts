/**
 * ワンストップ出稿 型定義
 */

/** 1動画分の出稿リクエスト */
export class CreateSingleInput {
  /** ギガファイル便URL（まとめURL or 個別ファイルURL） */
  gigafileUrl: string;
  /** ギガファイル便サーバー（個別ファイルDL用、file-listから取得） */
  gigafileServer?: string;
  /** ギガファイル便ファイルキー（個別ファイルDL用、file-listから取得） */
  gigafileFileKey?: string;
  /** 出稿先アカウントID */
  advertiserId: string;
  /** 導線: AI / SNS / スキルプラス */
  appeal: string;
  /** LP番号 (1, 2, 3...) */
  lpNumber: number;
  /** CR制作者名 */
  creatorName: string;
  /** CR名（省略時は動画ファイル名から自動抽出） */
  crName?: string;
  /** 日予算 (省略時はデフォルト) */
  dailyBudget?: number;
  /** 除外オーディエンスID配列 */
  excludedAudienceIds?: string[];
  /** 広告文（省略時はデフォルト） */
  adText?: string;
}

/** 出稿結果 */
export interface CreateSingleResult {
  status: 'SUCCESS' | 'FAILED';
  /** 広告名 */
  adName?: string;
  /** TikTok広告ID */
  adId?: string;
  /** キャンペーンID */
  campaignId?: string;
  /** 広告グループID */
  adgroupId?: string;
  /** CR番号 */
  crNumber?: number;
  /** UTAGE登録経路 */
  utagePath?: string;
  /** 遷移先URL */
  destinationUrl?: string;
  /** エラーメッセージ */
  error?: string;
  /** 失敗ステップ */
  failedStep?: string;
}

/** プレビューリクエスト */
export class PreviewInput {
  gigafileUrls: string[];
}

/** プレビューレスポンス */
export interface PreviewResult {
  files: {
    url: string;
    filename: string;
  }[];
}

/** 一括出稿リクエスト（ギガファイル便の複数ファイルを一括出稿） */
export class CreateBatchInput {
  /** ギガファイル便URL（複数ファイルが含まれるまとめURL） */
  gigafileUrl: string;
  /** 出稿先アカウントID */
  advertiserId: string;
  /** 導線: AI / SNS / スキルプラス */
  appeal: string;
  /** LP番号 (1, 2, 3...) */
  lpNumber: number;
  /** CR制作者名 */
  creatorName: string;
  /** CR名（省略時は動画ファイル名から自動抽出） */
  crName?: string;
  /** 日予算 (省略時はデフォルト) */
  dailyBudget?: number;
  /** 除外オーディエンスID配列 */
  excludedAudienceIds?: string[];
  /** 広告文（省略時はデフォルト） */
  adText?: string;
}

/** 一括出稿結果 */
export interface CreateBatchResult {
  totalFiles: number;
  success: number;
  failed: number;
  results: CreateSingleResult[];
}

/** カスタムオーディエンス */
export interface CustomAudience {
  custom_audience_id: string;
  name: string;
  audience_type: string;
  audience_sub_type?: string;
  size?: number;
}
