import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';
import {
  withRetry,
  validateSpreadsheetUrl,
  checkDataFreshness,
  detectColumnPositions,
  classifyGoogleSheetsError,
  logGoogleSheetsError,
  isGoogleSheetsErrorRetryable,
  GoogleSheetsErrorType,
  GoogleSheetsErrorInfo,
} from '../common/utils';

interface SheetCacheEntry {
  data: any[][];
  timestamp: number;
  columnPositions?: { [key: string]: number };
  freshnessChecked?: boolean;
  freshnessWarning?: GoogleSheetsErrorInfo;
}

/**
 * 列位置の期待値定義
 * registrationPath: 登録経路列
 * date: 登録日時列
 */
const EXPECTED_COLUMNS = {
  registrationPath: ['登録経路', '流入経路', 'registration_path', 'path', 'ファネル登録経路'],
  date: ['登録日時', '登録日', 'date', 'created_at', 'timestamp', 'アクション実行日時', '実行日時'],
};

@Injectable()
export class GoogleSheetsService {
  private readonly logger = new Logger(GoogleSheetsService.name);
  private readonly sheets;
  private readonly auth;
  private readonly sheetCache: Map<string, SheetCacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5分間キャッシュ
  private readonly MAX_CACHE_SIZE = 50; // M-03: キャッシュエントリ上限

  constructor(private configService: ConfigService) {
    // サービスアカウント認証
    const credentials = JSON.parse(
      this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS') || '{}',
    );

    this.auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  /**
   * シートデータをキャッシュを考慮して取得
   * リトライ対応: ネットワークエラー、レート制限時に自動リトライ
   * @param spreadsheetId スプレッドシートID
   * @param sheetName シート名
   * @param range 取得範囲（例：A:Z for full columns）
   * @returns シートデータ
   */
  private async getSheetDataWithCache(
    spreadsheetId: string,
    sheetName: string,
    range: string,
  ): Promise<any[][]> {
    const cacheKey = `${spreadsheetId}:${sheetName}:${range}`;
    const now = Date.now();

    // キャッシュをチェック
    const cached = this.sheetCache.get(cacheKey);
    if (cached && now - cached.timestamp < this.CACHE_TTL_MS) {
      this.logger.log(`Using cached data for ${spreadsheetId}/${sheetName}`);
      return cached.data;
    }

    // キャッシュがない、または期限切れの場合は新規取得（リトライ付き）
    this.logger.log(`Fetching fresh data from spreadsheet: ${spreadsheetId}, sheet: ${sheetName}`);

    const fullRange = `${sheetName}!${range}`;

    try {
      const response = await withRetry<any>(
        () => this.sheets.spreadsheets.values.get({
          spreadsheetId,
          range: fullRange,
        }),
        {
          maxRetries: 3,
          initialDelayMs: 1000,
          backoffMultiplier: 2,
          retryableErrors: isGoogleSheetsErrorRetryable,
          onRetry: (error, attempt, delayMs) => {
            const errorInfo = classifyGoogleSheetsError(error);
            logGoogleSheetsError(this.logger, errorInfo, `getSheetData(${sheetName})`);
            this.logger.warn(
              `[getSheetData] Attempt ${attempt}/3 failed. Retrying in ${delayMs}ms...`,
            );
          },
        },
        this.logger,
      );

      const data = response.data?.values || [];

      // M-03: キャッシュサイズ上限チェック
      this.enforceMaxCacheSize();

      // キャッシュに保存
      this.sheetCache.set(cacheKey, {
        data,
        timestamp: now,
      });

      return data;
    } catch (error) {
      const errorInfo = classifyGoogleSheetsError(error);
      logGoogleSheetsError(this.logger, errorInfo, `getSheetData(${sheetName})`);
      throw error;
    }
  }

  /**
   * シートデータを取得し、列位置を自動検出（G-07対応）
   * @param spreadsheetId スプレッドシートID
   * @param sheetName シート名
   * @returns シートデータと列位置情報
   */
  private async getSheetDataWithColumnDetection(
    spreadsheetId: string,
    sheetName: string,
  ): Promise<{
    data: any[][];
    columnPositions: { [key: string]: number };
    freshnessWarning?: GoogleSheetsErrorInfo;
  }> {
    // A列からZ列まで取得（列ズレに対応するため広範囲を取得）
    const fullRangeCacheKey = `${spreadsheetId}:${sheetName}:A:Z`;
    const now = Date.now();

    // キャッシュをチェック（列位置情報も含む）
    const cached = this.sheetCache.get(fullRangeCacheKey);
    if (cached && now - cached.timestamp < this.CACHE_TTL_MS && cached.columnPositions) {
      this.logger.log(`Using cached data with column positions for ${spreadsheetId}/${sheetName}`);
      return {
        data: cached.data,
        columnPositions: cached.columnPositions,
        freshnessWarning: cached.freshnessWarning,
      };
    }

    // データ取得
    const data = await this.getSheetDataWithCache(spreadsheetId, sheetName, 'A:Z');

    if (!data || data.length === 0) {
      return {
        data: [],
        columnPositions: { registrationPath: 4, date: 5 }, // デフォルト値
      };
    }

    // ヘッダー行から列位置を検出（G-07）
    const headerRow = data[0];
    const columnDetection = detectColumnPositions(headerRow, EXPECTED_COLUMNS);

    if (columnDetection.warning) {
      logGoogleSheetsError(this.logger, columnDetection.warning, sheetName);
    }

    // 列が見つからない場合はデフォルト位置を使用
    const columnPositions = {
      registrationPath: columnDetection.positions.registrationPath ?? 4, // E列
      date: columnDetection.positions.date ?? 5, // F列
    };

    // データ鮮度をチェック（G-06）
    const freshnessCheck = checkDataFreshness(data, columnPositions.date, 2);
    let freshnessWarning: GoogleSheetsErrorInfo | undefined;

    if (freshnessCheck.warning) {
      logGoogleSheetsError(this.logger, freshnessCheck.warning, sheetName);
      freshnessWarning = freshnessCheck.warning;
    }

    // キャッシュを更新（列位置情報と鮮度チェック結果を含む）
    this.sheetCache.set(fullRangeCacheKey, {
      data,
      timestamp: now,
      columnPositions,
      freshnessChecked: true,
      freshnessWarning,
    });

    return {
      data,
      columnPositions,
      freshnessWarning,
    };
  }

  /**
   * スプレッドシートから指定範囲の値を取得
   * @param spreadsheetId スプレッドシートID
   * @param range 取得範囲（例: 'シート名!A:C'）
   * @returns 2次元配列
   */
  async getValues(spreadsheetId: string, range: string): Promise<string[][]> {
    try {
      const response = await withRetry<any>(
        () => this.sheets.spreadsheets.values.get({ spreadsheetId, range }),
        {
          maxRetries: 3,
          initialDelayMs: 1000,
          backoffMultiplier: 2,
          retryableErrors: isGoogleSheetsErrorRetryable,
          onRetry: (error, attempt, delayMs) => {
            this.logger.warn(`[getValues] Attempt ${attempt}/3 failed. Retrying in ${delayMs}ms...`);
          },
        },
        this.logger,
      );
      return response.data?.values || [];
    } catch (error) {
      const errorInfo = classifyGoogleSheetsError(error);
      logGoogleSheetsError(this.logger, errorInfo, `getValues(${range})`);
      throw error;
    }
  }

  /**
   * スプレッドシートの指定範囲に値を書き込み（既存セルの上書き）
   * @param spreadsheetId スプレッドシートID
   * @param range 書き込み範囲（例: 'シート名!B5:C5'）
   * @param values 書き込む値の2次元配列
   */
  async updateValues(
    spreadsheetId: string,
    range: string,
    values: string[][],
  ): Promise<void> {
    try {
      await withRetry<any>(
        () => this.sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values },
        }),
        {
          maxRetries: 3,
          initialDelayMs: 1000,
          backoffMultiplier: 2,
          retryableErrors: isGoogleSheetsErrorRetryable,
          onRetry: (error, attempt, delayMs) => {
            this.logger.warn(`[updateValues] Attempt ${attempt}/3 failed. Retrying in ${delayMs}ms...`);
          },
        },
        this.logger,
      );
      this.logger.log(`Updated values in range: ${range}`);
    } catch (error) {
      const errorInfo = classifyGoogleSheetsError(error);
      logGoogleSheetsError(this.logger, errorInfo, `updateValues(${range})`);
      throw error;
    }
  }

  /**
   * スプレッドシートの末尾に行を追加
   * @param spreadsheetId スプレッドシートID
   * @param range 追加先の範囲（例: 'シート名!A:C'）
   * @param values 追加する値の2次元配列
   */
  async appendValues(
    spreadsheetId: string,
    range: string,
    values: string[][],
  ): Promise<void> {
    try {
      await withRetry<any>(
        () => this.sheets.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values },
        }),
        {
          maxRetries: 3,
          initialDelayMs: 1000,
          backoffMultiplier: 2,
          retryableErrors: isGoogleSheetsErrorRetryable,
          onRetry: (error, attempt, delayMs) => {
            this.logger.warn(`[appendValues] Attempt ${attempt}/3 failed. Retrying in ${delayMs}ms...`);
          },
        },
        this.logger,
      );
      this.logger.log(`Appended values to range: ${range}`);
    } catch (error) {
      const errorInfo = classifyGoogleSheetsError(error);
      logGoogleSheetsError(this.logger, errorInfo, `appendValues(${range})`);
      throw error;
    }
  }

  /**
   * キャッシュをクリア（主にテスト用）
   */
  clearCache(): void {
    this.sheetCache.clear();
    this.logger.log('Sheet cache cleared');
  }

  /**
   * M-03: キャッシュサイズ上限を強制
   * 最大サイズを超えた場合、最も古いエントリを削除
   */
  private enforceMaxCacheSize(): void {
    if (this.sheetCache.size >= this.MAX_CACHE_SIZE) {
      // 最も古いエントリを見つけて削除
      let oldestKey: string | null = null;
      let oldestTimestamp = Infinity;

      for (const [key, entry] of this.sheetCache.entries()) {
        if (entry.timestamp < oldestTimestamp) {
          oldestTimestamp = entry.timestamp;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.sheetCache.delete(oldestKey);
        this.logger.log(`[M-03] キャッシュ上限到達: 最古のエントリを削除 (${oldestKey})`);
      }
    }
  }

  /**
   * スプレッドシートから登録経路の件数を取得
   * G-06: データ鮮度チェック、G-07: 列ズレ自動検出、G-08: URL形式検証対応
   * @param spreadsheetUrl スプレッドシートURL
   * @param sheetName シート名（例：TT_オプト）
   * @param registrationPath 登録経路（例：TikTok広告-SNS-LP1-CR00572）
   * @param startDate 開始日
   * @param endDate 終了日
   * @returns 件数
   */
  async countRegistrationPath(
    spreadsheetUrl: string,
    sheetName: string,
    registrationPath: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    try {
      // URLからスプレッドシートIDを抽出（G-08: URL形式検証）
      const spreadsheetId = this.extractSpreadsheetId(spreadsheetUrl);

      this.logger.log(
        `Counting registrations for path: ${registrationPath} in ${sheetName}`,
      );

      // シート全体のデータを取得（G-06: 鮮度チェック、G-07: 列位置自動検出）
      const { data: rows, columnPositions, freshnessWarning } =
        await this.getSheetDataWithColumnDetection(spreadsheetId, sheetName);

      // 鮮度警告がある場合はログに出力（処理は継続）
      if (freshnessWarning) {
        this.logger.warn(
          `[G-06] Data freshness warning for ${sheetName}: ${freshnessWarning.message}`,
        );
      }

      if (!rows || rows.length === 0) {
        this.logger.warn(`No data found in sheet: ${sheetName}`);
        return 0;
      }

      this.logger.log(
        `Using column positions: registrationPath=${columnPositions.registrationPath}, date=${columnPositions.date}`,
      );

      // ヘッダー行をスキップして、登録経路と日付で件数をカウント
      let count = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        // 動的に検出された列位置を使用（G-07対応）
        const pathValue = row[columnPositions.registrationPath];
        const dateValue = row[columnPositions.date];

        if (!pathValue || !dateValue) {
          continue;
        }

        // 登録経路が一致するかチェック
        if (pathValue !== registrationPath) {
          continue;
        }

        // 日付が範囲内かチェック
        const rowDate = this.parseDate(dateValue);
        if (!rowDate) {
          continue;
        }

        if (rowDate >= startDate && rowDate <= endDate) {
          count++;
        }
      }

      this.logger.log(
        `Found ${count} matches for path: ${registrationPath} in period: ${startDate.toISOString()} - ${endDate.toISOString()}`,
      );

      return count;
    } catch (error) {
      // エラーを分類してログ出力
      const errorInfo = classifyGoogleSheetsError(error);
      logGoogleSheetsError(this.logger, errorInfo, `countRegistrationPath(${sheetName})`);
      throw error;
    }
  }

  /**
   * CV数を取得
   * @param appealName 訴求名（SNS, AI, デザジュク）
   * @param registrationPath 登録経路
   * @param startDate 開始日
   * @param endDate 終了日
   * @returns CV数
   */
  async getCVCount(
    appealName: string,
    cvSpreadsheetUrl: string,
    registrationPath: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const sheetName = 'TT_オプト';
    return this.countRegistrationPath(cvSpreadsheetUrl, sheetName, registrationPath, startDate, endDate);
  }

  /**
   * フロント販売本数を取得
   * @param appealName 訴求名（SNS, AI, デザジュク）
   * @param registrationPath 登録経路
   * @param startDate 開始日
   * @param endDate 終了日
   * @returns フロント販売本数
   */
  async getFrontSalesCount(
    appealName: string,
    frontSpreadsheetUrl: string,
    registrationPath: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    // TT【OTO】とTT【3day】の両方のシートから取得して合算
    const sheetOTO = 'TT【OTO】';
    const sheet3day = 'TT【3day】';

    const countOTO = await this.countRegistrationPath(
      frontSpreadsheetUrl,
      sheetOTO,
      registrationPath,
      startDate,
      endDate,
    );

    const count3day = await this.countRegistrationPath(
      frontSpreadsheetUrl,
      sheet3day,
      registrationPath,
      startDate,
      endDate,
    );

    const totalCount = countOTO + count3day;

    this.logger.log(
      `Front sales count for ${registrationPath}: OTO=${countOTO}, 3day=${count3day}, total=${totalCount}`,
    );

    return totalCount;
  }

  /**
   * スプレッドシートURLからIDを抽出（G-08対応）
   * @param url スプレッドシートURL
   * @returns スプレッドシートID
   */
  private extractSpreadsheetId(url: string): string {
    // URL形式を検証（G-08）
    const validation = validateSpreadsheetUrl(url);

    if (!validation.isValid) {
      if (validation.error) {
        logGoogleSheetsError(this.logger, validation.error, 'extractSpreadsheetId');
      }
      throw new Error(`[G-08] Invalid spreadsheet URL: ${url}`);
    }

    return validation.spreadsheetId!;
  }

  /**
   * 個別予約数を取得
   *
   * 既存のcountRegistrationPathとは異なるロジック:
   * - 列位置はchannelTypeで固定（ヘッダー検出不要）
   * - 1セル内に改行区切りで複数の登録経路が含まれる場合があり、
   *   各行をカウントする
   *
   * @param channelType 導線タイプ（タブ名・列の決定に使用）
   * @param spreadsheetId スプレッドシートID
   * @param registrationPath 登録経路（例: TikTok広告-スキルプラス-LP2-CR00322）
   * @param startDate 開始日
   * @param endDate 終了日
   * @returns 個別予約件数
   */
  async getIndividualReservationCount(
    channelType: 'SNS' | 'AI' | 'SEMINAR',
    spreadsheetId: string,
    registrationPath: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const config: Record<string, { sheetName: string; dateColumnIndex: number; pathColumnIndex: number }> = {
      SEMINAR: { sheetName: 'スキルプラス（オートウェビナー用）', dateColumnIndex: 0, pathColumnIndex: 34 },
      AI: { sheetName: 'AI', dateColumnIndex: 0, pathColumnIndex: 46 },
      SNS: { sheetName: 'SNS', dateColumnIndex: 0, pathColumnIndex: 46 },
    };

    const { sheetName, dateColumnIndex, pathColumnIndex } = config[channelType];

    this.logger.log(
      `[個別予約] Counting for path: ${registrationPath}, sheet: ${sheetName}, pathCol: ${pathColumnIndex}`,
    );

    try {
      // AU列(46)まで取得するために A:AZ の範囲を指定
      const rows = await this.getSheetDataWithCache(spreadsheetId, sheetName, 'A:AZ');

      if (!rows || rows.length === 0) {
        this.logger.warn(`[個別予約] No data found in sheet: ${sheetName}`);
        return 0;
      }

      let count = 0;
      // ヘッダー行をスキップ
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const dateValue = row[dateColumnIndex];
        const pathValue = row[pathColumnIndex];

        if (!dateValue) continue;

        // 日付が範囲内かチェック
        const rowDate = this.parseDate(String(dateValue));
        if (!rowDate) continue;
        if (rowDate < startDate || rowDate > endDate) continue;

        // セル値がない場合はスキップ
        if (!pathValue) continue;

        // セル内の登録経路を改行で分割してカウント
        const lines = String(pathValue).split('\n');
        for (const line of lines) {
          if (line.trim() === registrationPath) {
            count++;
          }
        }
      }

      this.logger.log(
        `[個別予約] Found ${count} matches for path: ${registrationPath} in ${sheetName} (${startDate.toISOString()} - ${endDate.toISOString()})`,
      );

      return count;
    } catch (error) {
      const errorInfo = classifyGoogleSheetsError(error);
      logGoogleSheetsError(this.logger, errorInfo, `getIndividualReservationCount(${sheetName})`);
      throw error;
    }
  }

  /**
   * 日付文字列をDateオブジェクトに変換（JSTとして解釈）
   * スプレッドシートの日付はJST前提のため、タイムゾーン情報がなければ+09:00として扱う
   */
  private parseDate(dateString: string): Date | null {
    try {
      if (!dateString) return null;
      const trimmed = dateString.trim();

      // タイムゾーン情報が既にある場合はそのまま解釈
      if (/[+-]\d{2}:?\d{2}$|Z$/i.test(trimmed) || /GMT|UTC/i.test(trimmed)) {
        const date = new Date(trimmed);
        return isNaN(date.getTime()) ? null : date;
      }

      // タイムゾーンなし → JSTとしてパース
      // "2026/02/15", "2026/2/15", "2026-02-15", "2026/02/15 18:30:00" 等
      const match = trimmed.match(
        /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/,
      );
      if (match) {
        const [, year, month, day, time] = match;
        const mm = month.padStart(2, '0');
        const dd = day.padStart(2, '0');
        const timeStr = time || '00:00:00';
        const date = new Date(`${year}-${mm}-${dd}T${timeStr}+09:00`);
        return isNaN(date.getTime()) ? null : date;
      }

      // フォールバック
      const date = new Date(trimmed);
      return isNaN(date.getTime()) ? null : date;
    } catch (error) {
      return null;
    }
  }
}
