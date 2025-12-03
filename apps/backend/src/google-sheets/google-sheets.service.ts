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
  registrationPath: ['登録経路', '流入経路', 'registration_path', 'path'],
  date: ['登録日時', '登録日', 'date', 'created_at', 'timestamp'],
};

@Injectable()
export class GoogleSheetsService {
  private readonly logger = new Logger(GoogleSheetsService.name);
  private readonly sheets;
  private readonly auth;
  private readonly sheetCache: Map<string, SheetCacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5分間キャッシュ

  constructor(private configService: ConfigService) {
    // サービスアカウント認証
    const credentials = JSON.parse(
      this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS') || '{}',
    );

    this.auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
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
   * キャッシュをクリア（主にテスト用）
   */
  clearCache(): void {
    this.sheetCache.clear();
    this.logger.log('Sheet cache cleared');
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
   * 日付文字列をDateオブジェクトに変換
   * @param dateString 日付文字列
   * @returns Dateオブジェクト
   */
  private parseDate(dateString: string): Date | null {
    try {
      // さまざまな日付形式に対応
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return null;
      }
      return date;
    } catch (error) {
      return null;
    }
  }
}
