import { Logger } from '@nestjs/common';

/**
 * バッチ処理エラータイプ
 * 参照: docs/ERROR_HANDLING_REQUIREMENTS.md (S-01〜S-04)
 */
export enum BatchErrorType {
  // S-01: 同時実行競合
  CONCURRENT_EXECUTION = 'CONCURRENT_EXECUTION',
  // S-02: バッチタイムアウト
  BATCH_TIMEOUT = 'BATCH_TIMEOUT',
  // S-03: 部分的同期失敗
  PARTIAL_SYNC_FAILURE = 'PARTIAL_SYNC_FAILURE',
  // S-04: ジョブ実行漏れ
  JOB_SKIPPED = 'JOB_SKIPPED',
  // その他
  UNKNOWN = 'UNKNOWN',
}

export interface BatchErrorInfo {
  type: BatchErrorType;
  code?: string;
  message: string;
  isRetryable: boolean;
  jobName?: string;
  details?: any;
}

export interface BatchExecutionResult {
  jobName: string;
  startTime: Date;
  endTime?: Date;
  success: boolean;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  errors: BatchErrorInfo[];
  details?: any;
}

/**
 * バッチエラーを分類
 */
export function classifyBatchError(
  error: any,
  context?: { jobName?: string },
): BatchErrorInfo {
  const message = error.message || '';

  // タイムアウトエラー
  if (
    message.includes('timeout') ||
    message.includes('ETIMEDOUT') ||
    message.includes('ECONNABORTED')
  ) {
    return {
      type: BatchErrorType.BATCH_TIMEOUT,
      code: 'S-02',
      message: `[S-02] バッチタイムアウト: ${message}`,
      isRetryable: true,
      jobName: context?.jobName,
    };
  }

  // 同時実行エラー
  if (message.includes('already running') || message.includes('lock')) {
    return {
      type: BatchErrorType.CONCURRENT_EXECUTION,
      code: 'S-01',
      message: `[S-01] 同時実行競合: ${message}`,
      isRetryable: false,
      jobName: context?.jobName,
    };
  }

  // 不明なエラー
  return {
    type: BatchErrorType.UNKNOWN,
    message: message || 'Unknown batch error',
    isRetryable: false,
    jobName: context?.jobName,
  };
}

/**
 * バッチエラーのログ出力
 */
export function logBatchError(
  logger: Logger,
  errorInfo: BatchErrorInfo,
  context?: string,
): void {
  const prefix = context ? `[${context}] ` : '';
  const jobStr = errorInfo.jobName ? ` (job: ${errorInfo.jobName})` : '';

  switch (errorInfo.type) {
    case BatchErrorType.CONCURRENT_EXECUTION:
      logger.warn(`${prefix}[S-01] 同時実行競合${jobStr}: ${errorInfo.message}`);
      break;
    case BatchErrorType.BATCH_TIMEOUT:
      logger.error(`${prefix}[S-02] バッチタイムアウト${jobStr}: ${errorInfo.message}`);
      break;
    case BatchErrorType.PARTIAL_SYNC_FAILURE:
      logger.warn(`${prefix}[S-03] 部分的同期失敗${jobStr}: ${errorInfo.message}`);
      break;
    case BatchErrorType.JOB_SKIPPED:
      logger.warn(`${prefix}[S-04] ジョブスキップ${jobStr}: ${errorInfo.message}`);
      break;
    default:
      logger.error(`${prefix}不明なバッチエラー${jobStr}: ${errorInfo.message}`);
  }
}

/**
 * バッチ実行結果のログ出力
 */
export function logBatchExecutionResult(
  logger: Logger,
  result: BatchExecutionResult,
): void {
  const duration = result.endTime
    ? (result.endTime.getTime() - result.startTime.getTime()) / 1000
    : 0;

  if (result.success) {
    logger.log(
      `[${result.jobName}] Completed successfully: ${result.processedItems}/${result.totalItems} items processed in ${duration.toFixed(2)}s`,
    );
  } else {
    logger.warn(
      `[${result.jobName}] Completed with errors: ${result.processedItems}/${result.totalItems} items processed, ${result.failedItems} failed in ${duration.toFixed(2)}s`,
    );

    // エラー詳細を出力
    for (const error of result.errors) {
      logBatchError(logger, error, result.jobName);
    }
  }
}

/**
 * 部分的同期失敗のエラー情報を作成（S-03）
 */
export function createPartialSyncFailureError(
  jobName: string,
  totalItems: number,
  failedItems: number,
  failedIds: string[],
): BatchErrorInfo {
  return {
    type: BatchErrorType.PARTIAL_SYNC_FAILURE,
    code: 'S-03',
    message: `[S-03] 部分的同期失敗: ${failedItems}/${totalItems} items failed`,
    isRetryable: true,
    jobName,
    details: {
      totalItems,
      failedItems,
      failedIds: failedIds.slice(0, 10), // 最初の10件のみ記録
      hasMore: failedIds.length > 10,
    },
  };
}

/**
 * バッチ実行結果トラッカー
 * S-03対応: 部分的な失敗を追跡
 */
export class BatchExecutionTracker {
  private startTime: Date;
  private processedItems: number = 0;
  private failedItems: number = 0;
  private errors: BatchErrorInfo[] = [];
  private failedIds: string[] = [];

  constructor(
    private readonly jobName: string,
    private readonly totalItems: number,
  ) {
    this.startTime = new Date();
  }

  /**
   * 成功した処理を記録
   */
  recordSuccess(): void {
    this.processedItems++;
  }

  /**
   * 失敗した処理を記録
   */
  recordFailure(itemId: string, error: any): void {
    this.failedItems++;
    this.failedIds.push(itemId);

    const errorInfo = classifyBatchError(error, { jobName: this.jobName });
    errorInfo.details = { itemId };
    this.errors.push(errorInfo);
  }

  /**
   * カスタムエラーを追加
   */
  addError(errorInfo: BatchErrorInfo): void {
    this.errors.push(errorInfo);
  }

  /**
   * 実行結果を取得
   */
  getResult(): BatchExecutionResult {
    const endTime = new Date();
    const success = this.failedItems === 0;

    // 部分的な失敗がある場合は専用のエラーを追加
    if (this.failedItems > 0 && this.failedItems < this.totalItems) {
      this.errors.push(
        createPartialSyncFailureError(
          this.jobName,
          this.totalItems,
          this.failedItems,
          this.failedIds,
        ),
      );
    }

    return {
      jobName: this.jobName,
      startTime: this.startTime,
      endTime,
      success,
      totalItems: this.totalItems,
      processedItems: this.processedItems,
      failedItems: this.failedItems,
      errors: this.errors,
      details: {
        failedIds: this.failedIds,
      },
    };
  }
}

/**
 * バッチジョブのロック機能（S-01対応）
 * 同時実行を防止
 */
export class BatchJobLock {
  private locks: Map<string, { startTime: Date; timeout: number }> = new Map();

  /**
   * ロックを取得
   * @returns ロック取得成功かどうか
   */
  acquire(jobName: string, timeoutMs: number = 600000): boolean {
    const existing = this.locks.get(jobName);

    if (existing) {
      // タイムアウトをチェック
      const elapsed = Date.now() - existing.startTime.getTime();
      if (elapsed < existing.timeout) {
        return false; // まだロック中
      }
      // タイムアウトしている場合は強制解除
    }

    this.locks.set(jobName, {
      startTime: new Date(),
      timeout: timeoutMs,
    });

    return true;
  }

  /**
   * ロックを解放
   */
  release(jobName: string): void {
    this.locks.delete(jobName);
  }

  /**
   * ロック状態を確認
   */
  isLocked(jobName: string): boolean {
    const existing = this.locks.get(jobName);
    if (!existing) return false;

    const elapsed = Date.now() - existing.startTime.getTime();
    return elapsed < existing.timeout;
  }

  /**
   * ロック開始時刻を取得
   */
  getLockStartTime(jobName: string): Date | undefined {
    return this.locks.get(jobName)?.startTime;
  }
}

// シングルトンのジョブロック
export const batchJobLock = new BatchJobLock();
