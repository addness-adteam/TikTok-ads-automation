import { Injectable, Logger } from '@nestjs/common';
import { GoogleSheetsService } from '../../google-sheets/google-sheets.service';
import { ReservationRecord } from '../domain/services/attendance-count-service';

const SURVEY_SHEET_ID = '1iKwplhJwldYqnr89NFoF5z3WS4GqnFVKBNfOdTZMF9c';
/** 列位置（仮）: 実シート閲覧権限取得後に確定させる
 *   B列(col1) = 回答日時
 *   D列(col3) = 回答者名（参考）
 *   H列(col7) = メールアドレス
 */
const COL_RESERVED_AT = 1;
const COL_EMAIL = 7;

export interface ReservationSurveyReader {
  load(): Promise<ReservationRecord[]>;
}

@Injectable()
export class SheetsReservationSurveyReader implements ReservationSurveyReader {
  private readonly logger = new Logger(SheetsReservationSurveyReader.name);

  constructor(private readonly sheets: GoogleSheetsService) {}

  async load(): Promise<ReservationRecord[]> {
    // 閲覧権限付与後、最初のタブ名を自動特定して読む
    const meta = await (this.sheets as any).sheets.spreadsheets.get({
      spreadsheetId: SURVEY_SHEET_ID,
    });
    const firstTab = meta.data.sheets?.[0]?.properties?.title;
    if (!firstTab) throw new Error('予約者アンケート: タブが見つからない');
    const rows = await this.sheets.getValues(
      SURVEY_SHEET_ID,
      `${firstTab}!A1:Z`,
    );
    return this.parseRows(rows);
  }

  /** テスト可能な純粋関数 */
  parseRows(rows: string[][]): ReservationRecord[] {
    const result: ReservationRecord[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const rawEmail = row[COL_EMAIL];
      const rawDate = row[COL_RESERVED_AT];
      if (!rawEmail || !rawDate) continue;
      const email = String(rawEmail).trim().toLowerCase();
      if (!email.includes('@')) continue;
      const reservedAt = this.parseTimestamp(rawDate);
      if (!reservedAt) continue;
      result.push({ email, reservedAt });
    }
    this.logger.log(`予約者アンケート読込: ${result.length}件`);
    return result;
  }

  private parseTimestamp(v: any): Date | null {
    if (!v) return null;
    const s = String(v).trim();
    // Google Form の日時は "2026/04/05 12:34:56" や "2026-04-05T12:34:56" 形式
    const normalized = s.replace(/\//g, '-').replace(' ', 'T');
    const tzAware =
      normalized.length > 10 &&
      !normalized.endsWith('Z') &&
      !/[\+\-]\d{2}:?\d{2}$/.test(normalized)
        ? normalized + '+09:00'
        : normalized;
    const d = new Date(tzAware);
    return isNaN(d.getTime()) ? null : d;
  }
}
