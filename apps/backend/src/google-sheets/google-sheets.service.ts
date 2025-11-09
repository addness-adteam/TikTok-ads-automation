import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';

interface SheetCacheEntry {
  data: any[][];
  timestamp: number;
}

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
   * @param spreadsheetId スプレッドシートID
   * @param sheetName シート名
   * @param range 取得範囲（例：E:F）
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

    // キャッシュがない、または期限切れの場合は新規取得
    this.logger.log(`Fetching fresh data from spreadsheet: ${spreadsheetId}, sheet: ${sheetName}`);

    const fullRange = `${sheetName}!${range}`;
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: fullRange,
    });

    const data = response.data.values || [];

    // キャッシュに保存
    this.sheetCache.set(cacheKey, {
      data,
      timestamp: now,
    });

    return data;
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
      // URLからスプレッドシートIDを抽出
      const spreadsheetId = this.extractSpreadsheetId(spreadsheetUrl);

      this.logger.log(
        `Counting registrations for path: ${registrationPath} in ${sheetName}`,
      );

      // シート全体のデータをキャッシュ経由で取得（E列とF列）
      const rows = await this.getSheetDataWithCache(spreadsheetId, sheetName, 'E:F');

      if (!rows || rows.length === 0) {
        this.logger.warn(`No data found in sheet: ${sheetName}`);
        return 0;
      }

      // ヘッダー行をスキップして、登録経路と日付で件数をカウント
      let count = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const pathValue = row[0]; // E列: 登録経路
        const dateValue = row[1]; // F列: 登録日時

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
      this.logger.error(`Failed to fetch data from Google Sheets: ${error.message}`, error);
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
   * スプレッドシートURLからIDを抽出
   * @param url スプレッドシートURL
   * @returns スプレッドシートID
   */
  private extractSpreadsheetId(url: string): string {
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) {
      throw new Error(`Invalid spreadsheet URL: ${url}`);
    }
    return match[1];
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
