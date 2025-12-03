import { Logger } from '@nestjs/common';

/**
 * 環境変数エラータイプ
 * 参照: docs/ERROR_HANDLING_REQUIREMENTS.md (E-01)
 */
export enum EnvErrorType {
  // E-01: 環境変数未設定
  ENV_NOT_SET = 'ENV_NOT_SET',
  // E-01: 環境変数形式不正
  ENV_INVALID_FORMAT = 'ENV_INVALID_FORMAT',
}

export interface EnvValidationResult {
  isValid: boolean;
  missingVars: string[];
  invalidVars: { name: string; reason: string }[];
  warnings: string[];
}

/**
 * 必須環境変数のリスト
 */
const REQUIRED_ENV_VARS = [
  // TikTok API
  'TIKTOK_APP_ID',
  'TIKTOK_APP_SECRET',
  'TIKTOK_API_BASE_URL',

  // Database
  'DATABASE_URL',

  // Google Sheets (オプショナルだが警告を出す)
  // 'GOOGLE_SERVICE_ACCOUNT_CREDENTIALS',
];

/**
 * オプショナルだが推奨の環境変数
 */
const RECOMMENDED_ENV_VARS = [
  'GOOGLE_SERVICE_ACCOUNT_CREDENTIALS',
  'TIKTOK_OAUTH_REDIRECT_URI',
];

/**
 * 環境変数の形式バリデーション
 */
const ENV_FORMAT_VALIDATORS: {
  [key: string]: (value: string) => { valid: boolean; reason?: string };
} = {
  DATABASE_URL: (value) => {
    if (!value.startsWith('postgresql://') && !value.startsWith('postgres://')) {
      return { valid: false, reason: 'DATABASE_URLはpostgresql://で始まる必要があります' };
    }
    return { valid: true };
  },
  TIKTOK_API_BASE_URL: (value) => {
    if (!value.startsWith('https://')) {
      return { valid: false, reason: 'TIKTOK_API_BASE_URLはhttps://で始まる必要があります' };
    }
    return { valid: true };
  },
  GOOGLE_SERVICE_ACCOUNT_CREDENTIALS: (value) => {
    try {
      const parsed = JSON.parse(value);
      if (!parsed.client_email || !parsed.private_key) {
        return {
          valid: false,
          reason: 'GOOGLE_SERVICE_ACCOUNT_CREDENTIALSにclient_emailとprivate_keyが必要です',
        };
      }
      return { valid: true };
    } catch (e) {
      return { valid: false, reason: 'GOOGLE_SERVICE_ACCOUNT_CREDENTIALSは有効なJSONである必要があります' };
    }
  },
};

/**
 * 環境変数をバリデート（E-01対応）
 */
export function validateEnvironmentVariables(logger?: Logger): EnvValidationResult {
  const result: EnvValidationResult = {
    isValid: true,
    missingVars: [],
    invalidVars: [],
    warnings: [],
  };

  // 必須環境変数のチェック
  for (const varName of REQUIRED_ENV_VARS) {
    const value = process.env[varName];

    if (!value || value.trim() === '') {
      result.missingVars.push(varName);
      result.isValid = false;

      if (logger) {
        logger.error(`[E-01] 環境変数未設定: ${varName}`);
      }
    } else {
      // 形式バリデーション
      const validator = ENV_FORMAT_VALIDATORS[varName];
      if (validator) {
        const validation = validator(value);
        if (!validation.valid) {
          result.invalidVars.push({ name: varName, reason: validation.reason || 'Invalid format' });
          result.isValid = false;

          if (logger) {
            logger.error(`[E-01] 環境変数形式不正: ${varName} - ${validation.reason}`);
          }
        }
      }
    }
  }

  // 推奨環境変数のチェック（警告のみ）
  for (const varName of RECOMMENDED_ENV_VARS) {
    const value = process.env[varName];

    if (!value || value.trim() === '') {
      result.warnings.push(`${varName}が設定されていません（オプショナル）`);

      if (logger) {
        logger.warn(`[E-01] 推奨環境変数未設定: ${varName}`);
      }
    } else {
      // 形式バリデーション（設定されている場合）
      const validator = ENV_FORMAT_VALIDATORS[varName];
      if (validator) {
        const validation = validator(value);
        if (!validation.valid) {
          result.warnings.push(`${varName}: ${validation.reason}`);

          if (logger) {
            logger.warn(`[E-01] 環境変数形式警告: ${varName} - ${validation.reason}`);
          }
        }
      }
    }
  }

  return result;
}

/**
 * 起動時の環境変数バリデーション
 * main.tsまたはapp.module.tsで呼び出す
 */
export function validateEnvOnStartup(logger: Logger): void {
  logger.log('Validating environment variables...');

  const result = validateEnvironmentVariables(logger);

  if (!result.isValid) {
    const errorMessage = [
      '[E-01] 環境変数エラーにより起動を中断します:',
      ...result.missingVars.map((v) => `  - ${v}: 未設定`),
      ...result.invalidVars.map((v) => `  - ${v.name}: ${v.reason}`),
    ].join('\n');

    logger.error(errorMessage);

    // 本番環境では起動を中断
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Required environment variables are not set or invalid');
    }
  }

  if (result.warnings.length > 0) {
    logger.warn(`環境変数の警告: ${result.warnings.length}件`);
  }

  logger.log('Environment variables validation completed');
}

/**
 * 特定の環境変数が設定されているかチェック
 */
export function isEnvSet(varName: string): boolean {
  const value = process.env[varName];
  return value !== undefined && value.trim() !== '';
}

/**
 * 環境変数を取得（未設定の場合はデフォルト値を使用）
 */
export function getEnvOrDefault(varName: string, defaultValue: string): string {
  const value = process.env[varName];
  return value && value.trim() !== '' ? value : defaultValue;
}

/**
 * 環境変数を取得（必須、未設定の場合はエラー）
 */
export function getRequiredEnv(varName: string): string {
  const value = process.env[varName];
  if (!value || value.trim() === '') {
    throw new Error(`[E-01] Required environment variable ${varName} is not set`);
  }
  return value;
}
