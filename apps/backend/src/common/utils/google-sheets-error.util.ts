import { Logger } from '@nestjs/common';

/**
 * Google Sheetsエラータイプ
 * 参照: docs/ERROR_HANDLING_REQUIREMENTS.md
 */
export enum GoogleSheetsErrorType {
  // G-01: 認証エラー
  AUTH_ERROR = 'AUTH_ERROR',
  // G-02: シート不存在
  SHEET_NOT_FOUND = 'SHEET_NOT_FOUND',
  // G-03: アクセス権限不足
  PERMISSION_ERROR = 'PERMISSION_ERROR',
  // G-04: レート制限
  RATE_LIMIT = 'RATE_LIMIT',
  // G-05: データ形式不正
  DATA_FORMAT_ERROR = 'DATA_FORMAT_ERROR',
  // G-06: データ鮮度エラー（新規追加）
  DATA_STALENESS = 'DATA_STALENESS',
  // G-07: 列ズレエラー（新規追加）
  COLUMN_SHIFT = 'COLUMN_SHIFT',
  // G-08: URL形式エラー（新規追加）
  INVALID_URL = 'INVALID_URL',
  // その他
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export interface GoogleSheetsErrorInfo {
  type: GoogleSheetsErrorType;
  code?: number | string;
  message: string;
  isRetryable: boolean;
  details?: any;
}

/**
 * Google Sheets APIエラーを分類
 */
export function classifyGoogleSheetsError(error: any): GoogleSheetsErrorInfo {
  const message = error.message || '';
  const code = error.code || error.response?.status;

  // ネットワークエラー
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return {
      type: GoogleSheetsErrorType.NETWORK_ERROR,
      code: error.code,
      message: `ネットワークエラー: ${message}`,
      isRetryable: true,
    };
  }

  // HTTPステータスコードベースの分類
  if (code === 401) {
    return {
      type: GoogleSheetsErrorType.AUTH_ERROR,
      code,
      message: '[G-01] 認証エラー: サービスアカウントの認証に失敗しました。',
      isRetryable: false,
    };
  }

  if (code === 403) {
    return {
      type: GoogleSheetsErrorType.PERMISSION_ERROR,
      code,
      message: '[G-03] 権限エラー: スプレッドシートへのアクセス権がありません。',
      isRetryable: false,
    };
  }

  if (code === 404 || message.includes('Unable to parse range') || message.includes('not found')) {
    return {
      type: GoogleSheetsErrorType.SHEET_NOT_FOUND,
      code,
      message: `[G-02] シート不存在: ${message}`,
      isRetryable: false,
    };
  }

  if (code === 429) {
    return {
      type: GoogleSheetsErrorType.RATE_LIMIT,
      code,
      message: '[G-04] レート制限: APIリクエスト制限に達しました。',
      isRetryable: true,
    };
  }

  if (code >= 500) {
    return {
      type: GoogleSheetsErrorType.API_ERROR,
      code,
      message: `Google Sheets APIサーバーエラー: ${code}`,
      isRetryable: true,
    };
  }

  // 不明なエラー
  return {
    type: GoogleSheetsErrorType.UNKNOWN,
    message: message || 'Unknown error',
    isRetryable: false,
  };
}

/**
 * Google Sheetsエラーのログ出力
 */
export function logGoogleSheetsError(
  logger: Logger,
  errorInfo: GoogleSheetsErrorInfo,
  context?: string,
): void {
  const prefix = context ? `[${context}] ` : '';
  const codeStr = errorInfo.code ? ` (code: ${errorInfo.code})` : '';

  switch (errorInfo.type) {
    case GoogleSheetsErrorType.AUTH_ERROR:
      logger.error(`${prefix}[G-01] 認証エラー${codeStr}: ${errorInfo.message}`);
      break;
    case GoogleSheetsErrorType.SHEET_NOT_FOUND:
      logger.error(`${prefix}[G-02] シート不存在${codeStr}: ${errorInfo.message}`);
      break;
    case GoogleSheetsErrorType.PERMISSION_ERROR:
      logger.error(`${prefix}[G-03] 権限エラー${codeStr}: ${errorInfo.message}`);
      break;
    case GoogleSheetsErrorType.RATE_LIMIT:
      logger.warn(`${prefix}[G-04] レート制限${codeStr}: ${errorInfo.message}`);
      break;
    case GoogleSheetsErrorType.DATA_FORMAT_ERROR:
      logger.warn(`${prefix}[G-05] データ形式不正${codeStr}: ${errorInfo.message}`);
      break;
    case GoogleSheetsErrorType.DATA_STALENESS:
      logger.warn(`${prefix}[G-06] データ鮮度警告${codeStr}: ${errorInfo.message}`);
      break;
    case GoogleSheetsErrorType.COLUMN_SHIFT:
      logger.warn(`${prefix}[G-07] 列ズレ検出${codeStr}: ${errorInfo.message}`);
      break;
    case GoogleSheetsErrorType.INVALID_URL:
      logger.error(`${prefix}[G-08] URL形式エラー${codeStr}: ${errorInfo.message}`);
      break;
    default:
      logger.error(`${prefix}不明なエラー${codeStr}: ${errorInfo.message}`);
  }
}

/**
 * Google Sheetsエラーがリトライ可能かどうかを判定
 */
export function isGoogleSheetsErrorRetryable(error: any): boolean {
  const errorInfo = classifyGoogleSheetsError(error);
  return errorInfo.isRetryable;
}

/**
 * スプレッドシートURL形式を検証（G-08）
 * @param url スプレッドシートURL
 * @returns 検証結果
 */
export function validateSpreadsheetUrl(url: string): {
  isValid: boolean;
  spreadsheetId?: string;
  error?: GoogleSheetsErrorInfo;
} {
  if (!url || typeof url !== 'string') {
    return {
      isValid: false,
      error: {
        type: GoogleSheetsErrorType.INVALID_URL,
        message: '[G-08] URL形式エラー: URLが空または不正です。',
        isRetryable: false,
      },
    };
  }

  // Google Sheets URLパターン
  // https://docs.google.com/spreadsheets/d/{spreadsheetId}/...
  const patterns = [
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
    /^https:\/\/sheets\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        isValid: true,
        spreadsheetId: match[1],
      };
    }
  }

  return {
    isValid: false,
    error: {
      type: GoogleSheetsErrorType.INVALID_URL,
      message: `[G-08] URL形式エラー: 有効なGoogle SheetsのURLではありません: ${url}`,
      isRetryable: false,
      details: { url },
    },
  };
}

/**
 * データ鮮度をチェック（G-06）
 * @param rows シートデータ
 * @param dateColumnIndex 日付列のインデックス
 * @param maxStaleDays 許容する古さ（日数）
 * @returns 鮮度チェック結果
 */
export function checkDataFreshness(
  rows: any[][],
  dateColumnIndex: number,
  maxStaleDays: number = 2,
): {
  isFresh: boolean;
  latestDate?: Date;
  daysSinceUpdate?: number;
  warning?: GoogleSheetsErrorInfo;
} {
  if (!rows || rows.length <= 1) {
    return {
      isFresh: false,
      warning: {
        type: GoogleSheetsErrorType.DATA_STALENESS,
        message: '[G-06] データ鮮度警告: シートにデータがありません。',
        isRetryable: false,
      },
    };
  }

  let latestDate: Date | null = null;

  // ヘッダーをスキップして最新の日付を探す
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateValue = row[dateColumnIndex];

    if (!dateValue) continue;

    const date = parseFlexibleDate(dateValue);
    if (date && (!latestDate || date > latestDate)) {
      latestDate = date;
    }
  }

  if (!latestDate) {
    return {
      isFresh: false,
      warning: {
        type: GoogleSheetsErrorType.DATA_STALENESS,
        message: '[G-06] データ鮮度警告: 有効な日付データが見つかりません。',
        isRetryable: false,
      },
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  latestDate.setHours(0, 0, 0, 0);

  const daysDiff = Math.floor((today.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff > maxStaleDays) {
    return {
      isFresh: false,
      latestDate,
      daysSinceUpdate: daysDiff,
      warning: {
        type: GoogleSheetsErrorType.DATA_STALENESS,
        message: `[G-06] データ鮮度警告: シートデータが${daysDiff}日前から更新されていません。最終更新: ${latestDate.toISOString().split('T')[0]}`,
        isRetryable: false,
        details: { latestDate, daysDiff },
      },
    };
  }

  return {
    isFresh: true,
    latestDate,
    daysSinceUpdate: daysDiff,
  };
}

/**
 * 列ズレを検出（G-07）
 * @param headerRow ヘッダー行
 * @param expectedColumns 期待する列名のマッピング
 * @returns 列位置の検出結果
 */
export function detectColumnPositions(
  headerRow: any[],
  expectedColumns: { [key: string]: string[] },
): {
  positions: { [key: string]: number };
  hasShift: boolean;
  originalPositions?: { [key: string]: number };
  warning?: GoogleSheetsErrorInfo;
} {
  const positions: { [key: string]: number } = {};
  const detectedColumns: string[] = [];

  for (const [columnKey, possibleNames] of Object.entries(expectedColumns)) {
    let foundIndex = -1;

    for (let i = 0; i < headerRow.length; i++) {
      const cellValue = String(headerRow[i] || '').trim();
      if (possibleNames.some((name) => cellValue.includes(name))) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex >= 0) {
      positions[columnKey] = foundIndex;
      detectedColumns.push(`${columnKey}=${foundIndex}`);
    }
  }

  // 全ての期待する列が見つかったかチェック
  const missingColumns = Object.keys(expectedColumns).filter((key) => positions[key] === undefined);

  if (missingColumns.length > 0) {
    return {
      positions,
      hasShift: true,
      warning: {
        type: GoogleSheetsErrorType.COLUMN_SHIFT,
        message: `[G-07] 列ズレ検出: 以下の列が見つかりません: ${missingColumns.join(', ')}`,
        isRetryable: false,
        details: { missingColumns, detectedColumns },
      },
    };
  }

  // デフォルト位置と比較して列ズレを検出
  // registrationPath: E列(4), date: F列(5) がデフォルト
  const defaultPositions: { [key: string]: number } = {
    registrationPath: 4, // E列
    date: 5, // F列
  };

  let hasShift = false;
  for (const [key, defaultPos] of Object.entries(defaultPositions)) {
    if (positions[key] !== undefined && positions[key] !== defaultPos) {
      hasShift = true;
      break;
    }
  }

  if (hasShift) {
    return {
      positions,
      hasShift: true,
      originalPositions: defaultPositions,
      warning: {
        type: GoogleSheetsErrorType.COLUMN_SHIFT,
        message: `[G-07] 列ズレ検出: 列位置がデフォルトと異なります。検出位置: ${detectedColumns.join(', ')}`,
        isRetryable: false,
        details: { detectedPositions: positions, defaultPositions },
      },
    };
  }

  return {
    positions,
    hasShift: false,
  };
}

/**
 * 柔軟な日付パース
 */
function parseFlexibleDate(dateString: string): Date | null {
  if (!dateString) return null;

  try {
    // ISO形式
    let date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      return date;
    }

    // yyyy/MM/dd HH:mm:ss 形式
    const jpFormat = dateString.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?/);
    if (jpFormat) {
      const [, year, month, day, hour = '0', minute = '0', second = '0'] = jpFormat;
      date = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second),
      );
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    // yyyy-MM-dd 形式
    const dashFormat = dateString.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (dashFormat) {
      const [, year, month, day] = dashFormat;
      date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  } catch {
    return null;
  }
}
