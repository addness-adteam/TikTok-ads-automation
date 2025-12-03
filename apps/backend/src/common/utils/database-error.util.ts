import { Logger } from '@nestjs/common';

/**
 * データベースエラータイプ
 * 参照: docs/ERROR_HANDLING_REQUIREMENTS.md (D-01〜D-05)
 */
export enum DatabaseErrorType {
  // D-01: 重複キー違反
  DUPLICATE_KEY = 'DUPLICATE_KEY',
  // D-02: 外部キー制約違反（対策済み）
  FOREIGN_KEY_VIOLATION = 'FOREIGN_KEY_VIOLATION',
  // D-03: 接続タイムアウト
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  // D-04: 親レコード未検出（対策済み）
  PARENT_NOT_FOUND = 'PARENT_NOT_FOUND',
  // D-05: メトリクス重複
  METRICS_DUPLICATE = 'METRICS_DUPLICATE',
  // その他
  TRANSACTION_ERROR = 'TRANSACTION_ERROR',
  QUERY_ERROR = 'QUERY_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export interface DatabaseErrorInfo {
  type: DatabaseErrorType;
  code?: string;
  message: string;
  isRetryable: boolean;
  table?: string;
  operation?: string;
  details?: any;
}

/**
 * Prismaエラーコード
 * https://www.prisma.io/docs/reference/api-reference/error-reference
 */
const PRISMA_ERROR_CODES: { [key: string]: DatabaseErrorType } = {
  P2002: DatabaseErrorType.DUPLICATE_KEY, // Unique constraint failed
  P2003: DatabaseErrorType.FOREIGN_KEY_VIOLATION, // Foreign key constraint failed
  P2025: DatabaseErrorType.PARENT_NOT_FOUND, // Record not found
  P2024: DatabaseErrorType.CONNECTION_TIMEOUT, // Timed out fetching connection
  P2028: DatabaseErrorType.TRANSACTION_ERROR, // Transaction API error
};

/**
 * データベースエラーを分類
 */
export function classifyDatabaseError(error: any): DatabaseErrorInfo {
  const code = error.code;
  const message = error.message || '';
  const meta = error.meta;

  // Prismaエラーコードをチェック
  if (code && PRISMA_ERROR_CODES[code]) {
    const errorType = PRISMA_ERROR_CODES[code];

    switch (errorType) {
      case DatabaseErrorType.DUPLICATE_KEY:
        return {
          type: errorType,
          code: 'D-01',
          message: `[D-01] 重複キー違反: ${meta?.target?.join(', ') || 'unknown field'}`,
          isRetryable: true, // トランザクションでリトライ可能
          table: meta?.modelName,
          details: { prismaCode: code, target: meta?.target },
        };

      case DatabaseErrorType.FOREIGN_KEY_VIOLATION:
        return {
          type: errorType,
          code: 'D-02',
          message: `[D-02] 外部キー制約違反: ${message}`,
          isRetryable: false,
          table: meta?.modelName,
          details: { prismaCode: code, field: meta?.field_name },
        };

      case DatabaseErrorType.PARENT_NOT_FOUND:
        return {
          type: errorType,
          code: 'D-04',
          message: `[D-04] レコード未検出: ${message}`,
          isRetryable: false,
          details: { prismaCode: code },
        };

      case DatabaseErrorType.CONNECTION_TIMEOUT:
        return {
          type: errorType,
          code: 'D-03',
          message: `[D-03] 接続タイムアウト: データベースへの接続がタイムアウトしました`,
          isRetryable: true,
          details: { prismaCode: code },
        };

      case DatabaseErrorType.TRANSACTION_ERROR:
        return {
          type: errorType,
          code: code,
          message: `トランザクションエラー: ${message}`,
          isRetryable: true,
          details: { prismaCode: code },
        };
    }
  }

  // 接続エラーのパターンマッチ
  if (
    message.includes('timeout') ||
    message.includes('ETIMEDOUT') ||
    message.includes('ECONNREFUSED')
  ) {
    return {
      type: DatabaseErrorType.CONNECTION_TIMEOUT,
      code: 'D-03',
      message: `[D-03] 接続タイムアウト: ${message}`,
      isRetryable: true,
    };
  }

  // 不明なエラー
  return {
    type: DatabaseErrorType.UNKNOWN,
    message: message || 'Unknown database error',
    isRetryable: false,
    details: { originalCode: code },
  };
}

/**
 * データベースエラーのログ出力
 */
export function logDatabaseError(
  logger: Logger,
  errorInfo: DatabaseErrorInfo,
  context?: string,
): void {
  const prefix = context ? `[${context}] ` : '';
  const tableStr = errorInfo.table ? ` (table: ${errorInfo.table})` : '';

  switch (errorInfo.type) {
    case DatabaseErrorType.DUPLICATE_KEY:
      logger.warn(`${prefix}[D-01] 重複キー違反${tableStr}: ${errorInfo.message}`);
      break;
    case DatabaseErrorType.FOREIGN_KEY_VIOLATION:
      logger.error(`${prefix}[D-02] 外部キー制約違反${tableStr}: ${errorInfo.message}`);
      break;
    case DatabaseErrorType.CONNECTION_TIMEOUT:
      logger.error(`${prefix}[D-03] 接続タイムアウト${tableStr}: ${errorInfo.message}`);
      break;
    case DatabaseErrorType.PARENT_NOT_FOUND:
      logger.warn(`${prefix}[D-04] レコード未検出${tableStr}: ${errorInfo.message}`);
      break;
    case DatabaseErrorType.METRICS_DUPLICATE:
      logger.warn(`${prefix}[D-05] メトリクス重複${tableStr}: ${errorInfo.message}`);
      break;
    default:
      logger.error(`${prefix}不明なDBエラー${tableStr}: ${errorInfo.message}`);
  }
}

/**
 * データベースエラーがリトライ可能かどうかを判定
 */
export function isDatabaseErrorRetryable(error: any): boolean {
  const errorInfo = classifyDatabaseError(error);
  return errorInfo.isRetryable;
}

/**
 * 重複キーエラー時のupsert用ヘルパー
 * D-01対応: 重複キー違反時にupsertで処理
 */
export async function withDuplicateKeyRetry<T>(
  operation: () => Promise<T>,
  upsertOperation: () => Promise<T>,
  logger?: Logger,
  context?: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const errorInfo = classifyDatabaseError(error);

    if (errorInfo.type === DatabaseErrorType.DUPLICATE_KEY) {
      if (logger) {
        logger.warn(
          `${context ? `[${context}] ` : ''}Duplicate key detected, falling back to upsert`,
        );
      }
      return await upsertOperation();
    }

    throw error;
  }
}

/**
 * トランザクション内でリトライを実行
 * D-01, D-03対応
 */
export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    backoffMultiplier?: number;
    logger?: Logger;
    context?: string;
  } = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 100,
    backoffMultiplier = 2,
    logger,
    context,
  } = options;

  let lastError: any;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // 最後の試行の場合はリトライしない
      if (attempt > maxRetries) {
        break;
      }

      // リトライ可能なエラーかチェック
      if (!isDatabaseErrorRetryable(error)) {
        if (logger) {
          const errorInfo = classifyDatabaseError(error);
          logDatabaseError(logger, errorInfo, context);
        }
        break;
      }

      if (logger) {
        logger.warn(
          `${context ? `[${context}] ` : ''}Database operation failed (attempt ${attempt}/${maxRetries + 1}). Retrying in ${delayMs}ms...`,
        );
      }

      // 待機
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      // 次回の遅延を計算（指数バックオフ）
      delayMs = delayMs * backoffMultiplier;
    }
  }

  throw lastError;
}
