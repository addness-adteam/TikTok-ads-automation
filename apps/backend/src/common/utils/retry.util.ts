import { Logger } from '@nestjs/common';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: (error: any) => boolean;
  onRetry?: (error: any, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'retryableErrors' | 'onRetry'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * 指数バックオフ付きリトライユーティリティ
 * 要件定義: リトライ回数3回、間隔1秒→2秒→4秒
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
  logger?: Logger,
): Promise<T> {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  let lastError: any;
  let delayMs = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // 最後の試行の場合はリトライしない
      if (attempt > opts.maxRetries) {
        break;
      }

      // リトライ可能なエラーかチェック
      if (opts.retryableErrors && !opts.retryableErrors(error)) {
        logger?.warn(`Non-retryable error encountered, not retrying: ${error.message}`);
        break;
      }

      // リトライコールバック
      if (opts.onRetry) {
        opts.onRetry(error, attempt, delayMs);
      } else if (logger) {
        logger.warn(
          `Attempt ${attempt}/${opts.maxRetries + 1} failed: ${error.message}. Retrying in ${delayMs}ms...`,
        );
      }

      // 待機
      await sleep(delayMs);

      // 次回の遅延を計算（指数バックオフ）
      delayMs = Math.min(delayMs * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * スリープユーティリティ
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTTPステータスコードがリトライ可能かどうかを判定
 */
export function isRetryableHttpStatus(status: number): boolean {
  // 408: Request Timeout
  // 429: Too Many Requests
  // 500: Internal Server Error
  // 502: Bad Gateway
  // 503: Service Unavailable
  // 504: Gateway Timeout
  return [408, 429, 500, 502, 503, 504].includes(status);
}

/**
 * Axiosエラーがリトライ可能かどうかを判定
 */
export function isRetryableAxiosError(error: any): boolean {
  // ネットワークエラー（接続失敗、タイムアウトなど）
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  // HTTPレスポンスエラー
  if (error.response?.status) {
    return isRetryableHttpStatus(error.response.status);
  }

  // リクエストが送信されたがレスポンスがない（ネットワーク問題）
  if (error.request && !error.response) {
    return true;
  }

  return false;
}
