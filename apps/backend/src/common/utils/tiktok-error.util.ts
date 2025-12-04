import { Logger } from '@nestjs/common';

/**
 * TikTok APIエラーコード分類
 * 参照: docs/ERROR_HANDLING_REQUIREMENTS.md
 */
export enum TikTokErrorType {
  // T-01: レート制限
  RATE_LIMIT = 'RATE_LIMIT',
  // T-02: 認証エラー
  AUTH_ERROR = 'AUTH_ERROR',
  // T-03: 権限不足
  PERMISSION_ERROR = 'PERMISSION_ERROR',
  // T-04: リソース不存在
  NOT_FOUND = 'NOT_FOUND',
  // T-06: タイムアウト
  TIMEOUT = 'TIMEOUT',
  // その他のエラー
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export interface TikTokErrorInfo {
  type: TikTokErrorType;
  code?: number | string;
  message: string;
  isRetryable: boolean;
  retryAfterMs?: number;
  originalError?: any;
}

/**
 * TikTok APIのレスポンスコード
 * https://business-api.tiktok.com/portal/docs?id=1737172488964097
 */
const TIKTOK_ERROR_CODES = {
  // 認証関連
  40001: TikTokErrorType.AUTH_ERROR, // Invalid access token
  40002: TikTokErrorType.AUTH_ERROR, // Access token expired
  40100: TikTokErrorType.AUTH_ERROR, // Unauthorized

  // 権限関連
  40003: TikTokErrorType.PERMISSION_ERROR, // No permission
  40300: TikTokErrorType.PERMISSION_ERROR, // Forbidden

  // レート制限
  40900: TikTokErrorType.RATE_LIMIT, // Too many requests

  // リソース不存在
  40400: TikTokErrorType.NOT_FOUND, // Resource not found
  40404: TikTokErrorType.NOT_FOUND, // Advertiser not found

  // サーバーエラー（リトライ可能）
  50000: TikTokErrorType.API_ERROR, // Internal server error
  50001: TikTokErrorType.API_ERROR, // Service unavailable
};

/**
 * TikTok APIエラーを分類
 */
export function classifyTikTokError(error: any): TikTokErrorInfo {
  // Axiosタイムアウトエラー
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return {
      type: TikTokErrorType.TIMEOUT,
      code: error.code,
      message: `リクエストがタイムアウトしました: ${error.message}`,
      isRetryable: true,
      originalError: error,
    };
  }

  // ネットワークエラー
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
    return {
      type: TikTokErrorType.NETWORK_ERROR,
      code: error.code,
      message: `ネットワークエラー: ${error.message}`,
      isRetryable: true,
      originalError: error,
    };
  }

  // HTTPレスポンスエラー
  if (error.response) {
    const status = error.response.status;
    const data = error.response.data;

    // TikTok API固有のエラーコードをチェック
    const apiCode = data?.code;
    if (apiCode && TIKTOK_ERROR_CODES[apiCode]) {
      const errorType = TIKTOK_ERROR_CODES[apiCode];
      return {
        type: errorType,
        code: apiCode,
        message: data?.message || `TikTok API Error: ${apiCode}`,
        isRetryable: errorType === TikTokErrorType.RATE_LIMIT || errorType === TikTokErrorType.API_ERROR,
        retryAfterMs: errorType === TikTokErrorType.RATE_LIMIT ? getRetryAfterMs(error.response) : undefined,
        originalError: error,
      };
    }

    // HTTPステータスコードベースの分類
    if (status === 429) {
      return {
        type: TikTokErrorType.RATE_LIMIT,
        code: status,
        message: 'レート制限に達しました。しばらく待ってから再試行してください。',
        isRetryable: true,
        retryAfterMs: getRetryAfterMs(error.response),
        originalError: error,
      };
    }

    if (status === 401) {
      return {
        type: TikTokErrorType.AUTH_ERROR,
        code: status,
        message: '認証エラー: アクセストークンが無効または期限切れです。',
        isRetryable: false,
        originalError: error,
      };
    }

    if (status === 403) {
      return {
        type: TikTokErrorType.PERMISSION_ERROR,
        code: status,
        message: '権限エラー: このリソースへのアクセス権がありません。',
        isRetryable: false,
        originalError: error,
      };
    }

    if (status === 404) {
      return {
        type: TikTokErrorType.NOT_FOUND,
        code: status,
        message: 'リソースが見つかりません。',
        isRetryable: false,
        originalError: error,
      };
    }

    if (status >= 500) {
      return {
        type: TikTokErrorType.API_ERROR,
        code: status,
        message: `TikTok APIサーバーエラー: ${status}`,
        isRetryable: true,
        originalError: error,
      };
    }
  }

  // 不明なエラー
  return {
    type: TikTokErrorType.UNKNOWN,
    message: error.message || 'Unknown error',
    isRetryable: false,
    originalError: error,
  };
}

/**
 * Retry-Afterヘッダーからリトライ待機時間を取得
 */
function getRetryAfterMs(response: any): number {
  const retryAfter = response.headers?.['retry-after'];
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }
  }
  // デフォルト: 60秒
  return 60000;
}

/**
 * TikTokエラーのログ出力
 */
export function logTikTokError(logger: Logger, errorInfo: TikTokErrorInfo, context?: string): void {
  const prefix = context ? `[${context}] ` : '';
  const codeStr = errorInfo.code ? ` (code: ${errorInfo.code})` : '';

  switch (errorInfo.type) {
    case TikTokErrorType.RATE_LIMIT:
      logger.warn(`${prefix}[T-01] レート制限${codeStr}: ${errorInfo.message}`);
      break;
    case TikTokErrorType.AUTH_ERROR:
      logger.error(`${prefix}[T-02] 認証エラー${codeStr}: ${errorInfo.message}`);
      break;
    case TikTokErrorType.PERMISSION_ERROR:
      logger.error(`${prefix}[T-03] 権限エラー${codeStr}: ${errorInfo.message}`);
      break;
    case TikTokErrorType.NOT_FOUND:
      logger.warn(`${prefix}[T-04] リソース不存在${codeStr}: ${errorInfo.message}`);
      break;
    case TikTokErrorType.TIMEOUT:
      logger.warn(`${prefix}[T-06] タイムアウト${codeStr}: ${errorInfo.message}`);
      break;
    case TikTokErrorType.NETWORK_ERROR:
      logger.error(`${prefix}ネットワークエラー${codeStr}: ${errorInfo.message}`);
      break;
    case TikTokErrorType.API_ERROR:
      logger.error(`${prefix}APIエラー${codeStr}: ${errorInfo.message}`);
      break;
    default:
      logger.error(`${prefix}不明なエラー${codeStr}: ${errorInfo.message}`);
  }
}

/**
 * TikTokエラーがリトライ可能かどうかを判定
 */
export function isTikTokErrorRetryable(error: any): boolean {
  const errorInfo = classifyTikTokError(error);
  return errorInfo.isRetryable;
}

/**
 * M-05: TikTok APIレスポンス構造を検証し、安全にデータを取得
 * 不正なレスポンスでundefinedエラーを防止
 */
export interface TikTokApiResponse<T = any> {
  code: number;
  message: string;
  data?: {
    list?: T[];
    page_info?: {
      total_number?: number;
      total_page?: number;
      page?: number;
      page_size?: number;
    };
  };
  request_id?: string;
}

/**
 * TikTok APIレスポンスを検証
 * @param response Axiosレスポンス
 * @param context ログ用コンテキスト
 * @returns 検証結果とデータ
 */
export function validateTikTokResponse<T = any>(
  response: any,
  context?: string,
): {
  isValid: boolean;
  list: T[];
  pageInfo: { totalNumber: number; totalPage: number; page: number; pageSize: number };
  code: number;
  message: string;
  warning?: string;
} {
  const prefix = context ? `[${context}] ` : '';

  // レスポンス自体の存在確認
  if (!response) {
    return {
      isValid: false,
      list: [],
      pageInfo: { totalNumber: 0, totalPage: 0, page: 0, pageSize: 0 },
      code: -1,
      message: 'No response received',
      warning: `${prefix}[M-05] レスポンスが空です`,
    };
  }

  // response.dataの存在確認
  if (!response.data) {
    return {
      isValid: false,
      list: [],
      pageInfo: { totalNumber: 0, totalPage: 0, page: 0, pageSize: 0 },
      code: -1,
      message: 'No data in response',
      warning: `${prefix}[M-05] response.dataが存在しません`,
    };
  }

  const apiResponse = response.data as TikTokApiResponse<T>;

  // TikTok APIのcodeを確認（0が成功）
  if (apiResponse.code !== 0) {
    return {
      isValid: false,
      list: [],
      pageInfo: { totalNumber: 0, totalPage: 0, page: 0, pageSize: 0 },
      code: apiResponse.code,
      message: apiResponse.message || 'Unknown API error',
      warning: `${prefix}[M-05] API応答コードがエラー: ${apiResponse.code} - ${apiResponse.message}`,
    };
  }

  // data.dataの存在確認
  if (!apiResponse.data) {
    return {
      isValid: true, // code=0だがdataがない場合は空リストとして扱う
      list: [],
      pageInfo: { totalNumber: 0, totalPage: 0, page: 0, pageSize: 0 },
      code: 0,
      message: 'Success but no data',
      warning: `${prefix}[M-05] response.data.dataが存在しません（空データとして処理）`,
    };
  }

  // listの取得（存在しない場合は空配列）
  const list = Array.isArray(apiResponse.data.list) ? apiResponse.data.list : [];

  // pageInfoの取得（存在しない場合はデフォルト値）
  const pageInfo = {
    totalNumber: apiResponse.data.page_info?.total_number ?? 0,
    totalPage: apiResponse.data.page_info?.total_page ?? 0,
    page: apiResponse.data.page_info?.page ?? 0,
    pageSize: apiResponse.data.page_info?.page_size ?? 0,
  };

  return {
    isValid: true,
    list,
    pageInfo,
    code: 0,
    message: apiResponse.message || 'Success',
  };
}

/**
 * TikTok APIのlist型レスポンスから安全にリストを取得
 * @param response Axiosレスポンス
 * @param defaultValue デフォルト値（空配列）
 * @returns リストデータ
 */
export function safeGetList<T = any>(response: any, defaultValue: T[] = []): T[] {
  try {
    const list = response?.data?.data?.list;
    return Array.isArray(list) ? list : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * TikTok APIのページ情報を安全に取得
 * @param response Axiosレスポンス
 * @returns ページ情報
 */
export function safeGetPageInfo(response: any): {
  totalNumber: number;
  totalPage: number;
  page: number;
  pageSize: number;
} {
  try {
    const pageInfo = response?.data?.data?.page_info;
    return {
      totalNumber: pageInfo?.total_number ?? 0,
      totalPage: pageInfo?.total_page ?? 0,
      page: pageInfo?.page ?? 0,
      pageSize: pageInfo?.page_size ?? 0,
    };
  } catch {
    return { totalNumber: 0, totalPage: 0, page: 0, pageSize: 0 };
  }
}
