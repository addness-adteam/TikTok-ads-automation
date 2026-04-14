import { Injectable, Logger } from '@nestjs/common';
import { GoogleSheetsService } from '../../google-sheets/google-sheets.service';

/** スキルプラス導線のオプトシートからメアド→最新LP-CRを解決する */
export interface OptLatestPathReader {
  load(): Promise<Map<string, { lpCr: string; timestamp: Date }>>;
}

const SP_OPT_SHEET_ID = '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk';
const SP_OPT_TAB = 'TT_オプト';
// 列位置（2025-09〜確認済）
const COL_EMAIL = 1;
const COL_REG_URL = 3;
const COL_FUNNEL_PATH = 4;
const COL_TIMESTAMP = 5;

@Injectable()
export class SheetsOptLatestPathReader implements OptLatestPathReader {
  private readonly logger = new Logger(SheetsOptLatestPathReader.name);

  constructor(private readonly sheets: GoogleSheetsService) {}

  async load(): Promise<Map<string, { lpCr: string; timestamp: Date }>> {
    const rows = await this.sheets.getValues(SP_OPT_SHEET_ID, `${SP_OPT_TAB}!A:F`);
    return this.buildLatestMap(rows);
  }

  /** テスト可能な純粋関数 */
  buildLatestMap(rows: string[][]): Map<string, { lpCr: string; timestamp: Date }> {
    const result = new Map<string, { lpCr: string; timestamp: Date }>();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const email = this.normalizeEmail(row[COL_EMAIL]);
      if (!email) continue;
      const lpCr = this.extractLpCr(row[COL_FUNNEL_PATH], row[COL_REG_URL]);
      if (!lpCr) continue;
      const ts = this.parseTimestamp(row[COL_TIMESTAMP]);
      if (!ts) continue;

      const existing = result.get(email);
      if (!existing || ts > existing.timestamp) {
        result.set(email, { lpCr, timestamp: ts });
      }
    }
    this.logger.log(`オプトマップ構築: ${result.size}件のユニークメアド`);
    return result;
  }

  private normalizeEmail(v: any): string {
    return String(v ?? '').trim().toLowerCase();
  }

  /** ファネル登録経路を優先、なければURLから推定 */
  private extractLpCr(funnelPath: any, regUrl: any): string | null {
    const candidates = [String(funnelPath ?? ''), String(regUrl ?? '')];
    for (const s of candidates) {
      const m = s.match(/LP\d+-?CR\d+/i);
      if (m) return m[0].toUpperCase().replace('-', '-');
    }
    return null;
  }

  private parseTimestamp(v: any): Date | null {
    if (!v) return null;
    const s = String(v).trim();
    // "2025-09-20 14:41:28" 形式をDate化
    const normalized = s.replace(' ', 'T');
    // JST想定。Zなしだとローカルtimezone扱いになるので +09:00 付与
    const tzAware = normalized.length > 10 && !normalized.endsWith('Z') && !/[\+\-]\d{2}:?\d{2}$/.test(normalized)
      ? normalized + '+09:00' : normalized;
    const d = new Date(tzAware);
    return isNaN(d.getTime()) ? null : d;
  }
}
