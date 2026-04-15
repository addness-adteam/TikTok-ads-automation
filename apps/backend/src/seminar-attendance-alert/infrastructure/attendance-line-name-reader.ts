import { Injectable, Logger } from '@nestjs/common';
import { GoogleSheetsService } from '../../google-sheets/google-sheets.service';

/**
 * 手動でLステップからCSVエクスポートして、着座者のLINE名をA列に
 * コピペするスプシ。毎日追記運用。
 *
 * - シート: 1HI8BywQwMY1MtSMr6Me4GQJ-Hrd4e0SWd4SvTXJL0JM
 * - タブ: シート1
 * - A列: LINE名（ヘッダー行1行、2行目以降がデータ）
 */
const ATTENDANCE_SHEET_ID = '1HI8BywQwMY1MtSMr6Me4GQJ-Hrd4e0SWd4SvTXJL0JM';
const ATTENDANCE_TAB = 'シート1';

export interface AttendanceLineNameReader {
  load(): Promise<Set<string>>;
}

@Injectable()
export class SheetsAttendanceLineNameReader implements AttendanceLineNameReader {
  private readonly logger = new Logger(SheetsAttendanceLineNameReader.name);

  constructor(private readonly sheets: GoogleSheetsService) {}

  async load(): Promise<Set<string>> {
    const rows = await this.sheets.getValues(
      ATTENDANCE_SHEET_ID,
      `${ATTENDANCE_TAB}!A:A`,
    );
    const set = this.parseRows(rows);
    this.logger.log(`着座LINE名読込: ${set.size}件 (ユニーク)`);
    return set;
  }

  /** テスト可能な純粋関数 */
  parseRows(rows: string[][]): Set<string> {
    const result = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const raw = rows[i]?.[0];
      if (!raw) continue;
      const name = String(raw).trim();
      if (name) result.add(name);
    }
    return result;
  }
}
