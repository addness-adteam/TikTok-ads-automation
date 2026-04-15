import { Injectable, Logger } from '@nestjs/common';
import { GoogleSheetsService } from '../../google-sheets/google-sheets.service';
import {
  AllowableSeminarSeatCpo,
  YearMonth,
} from '../domain/value-objects/allowable-seminar-seat-cpo';
import { JPY } from '../domain/value-objects/jpy';

/** 数値管理シートから月次許容セミナー着座CPOを取得する */
export interface AllowableCpoResolver {
  resolve(month: YearMonth): Promise<AllowableSeminarSeatCpo | null>;
}

const KPI_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';
const KPI_TAB = 'スキルプラス（オートウェビナー用）';
const MONTH_BLOCK_RANGE_ROWS = 40; // 月ブロック開始行から下に探索する最大行数

@Injectable()
export class SheetsAllowableCpoResolver implements AllowableCpoResolver {
  private readonly logger = new Logger(SheetsAllowableCpoResolver.name);

  constructor(private readonly sheets: GoogleSheetsService) {}

  async resolve(month: YearMonth): Promise<AllowableSeminarSeatCpo | null> {
    const rows = await this.sheets.getValues(
      KPI_SHEET_ID,
      `${KPI_TAB}!A1:AZ500`,
    );
    return this.extractFromRows(rows, month);
  }

  /**
   * 純粋関数として切り出してテスト可能にする
   */
  extractFromRows(
    rows: string[][],
    month: YearMonth,
  ): AllowableSeminarSeatCpo | null {
    // 1) 月ブロック開始行を探す: A列が "YYYY/M/1" の行
    const monthStartPattern = new RegExp(
      `^${month.year}[\\/\\-]${month.month}[\\/\\-]1$`,
    );
    let startRow = -1;
    for (let i = 0; i < rows.length; i++) {
      const a = String(rows[i]?.[0] ?? '').trim();
      if (monthStartPattern.test(a)) {
        startRow = i;
        break;
      }
    }
    if (startRow < 0) {
      this.logger.warn(`月ブロックが見つからない: ${month.toString()}`);
      return null;
    }

    // 2) 開始行から下方向 MONTH_BLOCK_RANGE_ROWS 行以内で
    //    「セミナー着座CPO」または「許容セミナー着座CPO」ラベルセルを探す
    //    ※ col1の"項目"ヘッダー等は既に月ブロック内なので除外されている
    const endRow = Math.min(startRow + MONTH_BLOCK_RANGE_ROWS, rows.length);
    for (let i = startRow; i < endRow; i++) {
      const row = rows[i] ?? [];
      for (let c = 0; c < row.length; c++) {
        const cell = String(row[c] ?? '').trim();
        // 「許容セミナー着座CPO」が明示されていればそれを最優先
        if (cell === '許容セミナー着座CPO') {
          const valueCell = row[c + 1];
          const parsed = this.parseAmount(valueCell);
          if (parsed != null) {
            this.logger.log(
              `[許容セミナー着座CPO] ${month.toString()} = ¥${parsed} (row ${i}, col ${c + 1})`,
            );
            return AllowableSeminarSeatCpo.of(month, JPY.of(parsed));
          }
        }
      }
    }
    // フォールバック: 「セミナー着座CPO」（"許容"なし）かつ月ブロック内の場合、右隣セルを許容値とする
    for (let i = startRow; i < endRow; i++) {
      const row = rows[i] ?? [];
      for (let c = 0; c < row.length; c++) {
        const cell = String(row[c] ?? '').trim();
        if (cell === 'セミナー着座CPO') {
          const valueCell = row[c + 1];
          const parsed = this.parseAmount(valueCell);
          if (parsed != null) {
            this.logger.log(
              `[セミナー着座CPO(許容)] ${month.toString()} = ¥${parsed} (row ${i}, col ${c + 1})`,
            );
            return AllowableSeminarSeatCpo.of(month, JPY.of(parsed));
          }
        }
      }
    }
    this.logger.warn(
      `許容セミナー着座CPO セルが見つからない: ${month.toString()}`,
    );
    return null;
  }

  /** "¥30,060" / "30,060" / "30060" 形式を数値化 */
  private parseAmount(v: any): number | null {
    if (v == null) return null;
    const s = String(v).replace(/[¥,￥\s]/g, '');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
}
