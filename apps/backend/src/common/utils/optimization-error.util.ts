import { Logger } from '@nestjs/common';

/**
 * 予算最適化エラータイプ
 * 参照: docs/ERROR_HANDLING_REQUIREMENTS.md (O-01〜O-06)
 */
export enum OptimizationErrorType {
  // O-01: 広告名パース失敗
  AD_NAME_PARSE_ERROR = 'AD_NAME_PARSE_ERROR',
  // O-02: Appeal未設定
  APPEAL_NOT_ASSIGNED = 'APPEAL_NOT_ASSIGNED',
  // O-03: Advertiser未検出
  ADVERTISER_NOT_FOUND = 'ADVERTISER_NOT_FOUND',
  // O-04: 目標CPA/CPO未設定
  TARGET_NOT_SET = 'TARGET_NOT_SET',
  // O-05: Smart+判定ミス
  SMART_PLUS_DETECTION_ERROR = 'SMART_PLUS_DETECTION_ERROR',
  // O-06: 予算更新API失敗
  BUDGET_UPDATE_FAILED = 'BUDGET_UPDATE_FAILED',
  // その他
  UNKNOWN = 'UNKNOWN',
}

export interface OptimizationErrorInfo {
  type: OptimizationErrorType;
  code?: string;
  message: string;
  isRetryable: boolean;
  entityId?: string;
  entityName?: string;
  details?: any;
}

/**
 * 最適化エラーを分類
 */
export function classifyOptimizationError(
  error: any,
  context?: { entityId?: string; entityName?: string },
): OptimizationErrorInfo {
  const message = error.message || '';

  // メッセージベースでエラータイプを判定
  if (message.includes('Invalid ad name') || message.includes('Invalid campaign name')) {
    return {
      type: OptimizationErrorType.AD_NAME_PARSE_ERROR,
      code: 'O-01',
      message: `[O-01] 広告名パース失敗: ${message}`,
      isRetryable: false,
      ...context,
    };
  }

  if (message.includes('No appeal assigned') || message.includes('Appeal not found')) {
    return {
      type: OptimizationErrorType.APPEAL_NOT_ASSIGNED,
      code: 'O-02',
      message: `[O-02] Appeal未設定: ${message}`,
      isRetryable: false,
      ...context,
    };
  }

  if (message.includes('Advertiser') && message.includes('not found')) {
    return {
      type: OptimizationErrorType.ADVERTISER_NOT_FOUND,
      code: 'O-03',
      message: `[O-03] Advertiser未検出: ${message}`,
      isRetryable: false,
      ...context,
    };
  }

  if (
    message.includes('targetCPA') ||
    message.includes('targetFrontCPO') ||
    message.includes('allowableCPA') ||
    message.includes('allowableFrontCPO')
  ) {
    return {
      type: OptimizationErrorType.TARGET_NOT_SET,
      code: 'O-04',
      message: `[O-04] 目標CPA/CPO未設定: ${message}`,
      isRetryable: false,
      ...context,
    };
  }

  if (message.includes('budget') || message.includes('Budget') || message.includes('予算')) {
    return {
      type: OptimizationErrorType.BUDGET_UPDATE_FAILED,
      code: 'O-06',
      message: `[O-06] 予算更新API失敗: ${message}`,
      isRetryable: true,
      ...context,
    };
  }

  // 不明なエラー
  return {
    type: OptimizationErrorType.UNKNOWN,
    message: message || 'Unknown optimization error',
    isRetryable: false,
    ...context,
  };
}

/**
 * 最適化エラーのログ出力
 */
export function logOptimizationError(
  logger: Logger,
  errorInfo: OptimizationErrorInfo,
  context?: string,
): void {
  const prefix = context ? `[${context}] ` : '';
  const entityStr = errorInfo.entityId ? ` (${errorInfo.entityName || errorInfo.entityId})` : '';

  switch (errorInfo.type) {
    case OptimizationErrorType.AD_NAME_PARSE_ERROR:
      logger.warn(`${prefix}[O-01] 広告名パース失敗${entityStr}: ${errorInfo.message}`);
      break;
    case OptimizationErrorType.APPEAL_NOT_ASSIGNED:
      logger.warn(`${prefix}[O-02] Appeal未設定${entityStr}: ${errorInfo.message}`);
      break;
    case OptimizationErrorType.ADVERTISER_NOT_FOUND:
      logger.warn(`${prefix}[O-03] Advertiser未検出${entityStr}: ${errorInfo.message}`);
      break;
    case OptimizationErrorType.TARGET_NOT_SET:
      logger.warn(`${prefix}[O-04] 目標CPA/CPO未設定${entityStr}: ${errorInfo.message}`);
      break;
    case OptimizationErrorType.SMART_PLUS_DETECTION_ERROR:
      logger.warn(`${prefix}[O-05] Smart+判定エラー${entityStr}: ${errorInfo.message}`);
      break;
    case OptimizationErrorType.BUDGET_UPDATE_FAILED:
      logger.error(`${prefix}[O-06] 予算更新API失敗${entityStr}: ${errorInfo.message}`);
      break;
    default:
      logger.error(`${prefix}不明なエラー${entityStr}: ${errorInfo.message}`);
  }
}

/**
 * Appeal設定の検証（O-04対応）
 */
export function validateAppealSettings(appeal: any): {
  isValid: boolean;
  missingFields: string[];
  warning?: OptimizationErrorInfo;
} {
  const requiredFields = ['targetCPA', 'allowableCPA', 'targetFrontCPO', 'allowableFrontCPO'];
  const missingFields: string[] = [];

  for (const field of requiredFields) {
    if (appeal[field] === null || appeal[field] === undefined) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    return {
      isValid: false,
      missingFields,
      warning: {
        type: OptimizationErrorType.TARGET_NOT_SET,
        code: 'O-04',
        message: `[O-04] 目標CPA/CPO未設定: 以下のフィールドが未設定です: ${missingFields.join(', ')}`,
        isRetryable: false,
        details: { missingFields, appealId: appeal.id },
      },
    };
  }

  return {
    isValid: true,
    missingFields: [],
  };
}

/**
 * 広告名の形式検証（O-01対応）
 * 形式: 出稿日/制作者名/CR名/LP名-番号
 */
export function validateAdNameFormat(adName: string): {
  isValid: boolean;
  parsed?: { date: string; creator: string; creativeName: string; lpName: string };
  warning?: OptimizationErrorInfo;
} {
  if (!adName || typeof adName !== 'string') {
    return {
      isValid: false,
      warning: {
        type: OptimizationErrorType.AD_NAME_PARSE_ERROR,
        code: 'O-01',
        message: `[O-01] 広告名パース失敗: 広告名が空または不正です`,
        isRetryable: false,
        entityName: adName,
      },
    };
  }

  const parts = adName.split('/');

  // 最低4パート必要（出稿日/制作者名/CR名/LP名）
  if (parts.length < 4) {
    return {
      isValid: false,
      warning: {
        type: OptimizationErrorType.AD_NAME_PARSE_ERROR,
        code: 'O-01',
        message: `[O-01] 広告名パース失敗: 形式が不正です（/区切りが4未満）: ${adName}`,
        isRetryable: false,
        entityName: adName,
        details: { actualParts: parts.length, requiredParts: 4 },
      },
    };
  }

  return {
    isValid: true,
    parsed: {
      date: parts[0],
      creator: parts[1],
      creativeName: parts.slice(2, parts.length - 1).join('/'),
      lpName: parts[parts.length - 1],
    },
  };
}
