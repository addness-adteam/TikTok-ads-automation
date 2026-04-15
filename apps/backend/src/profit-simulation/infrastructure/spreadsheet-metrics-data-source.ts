// ============================================================================
// SpreadsheetMetricsDataSource - MetricsDataSourceポートのインフラ実装
// Google Sheets APIからファネル実績・KPI・目標粗利を取得する
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { GoogleSheetsService } from '../../google-sheets/google-sheets.service';
import { MetricsDataSource } from '../domain/ports';
import {
  ChannelType,
  MonthlyMetricsData,
  KPITargets,
  DailyMetrics,
} from '../domain/types';
import {
  parseKpiPercentage,
  parseKpiAmount,
  parseKpiValue,
} from './kpi-value-parser';

const SPREADSHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

// シート名
const SHEET_NAMES: Record<ChannelType, string> = {
  AI: 'AI',
  SNS: 'SNS',
  SKILL_PLUS: 'スキルプラス（オートウェビナー用）',
};

// AI/SNSのカラムマッピング（index）
const AI_SNS_COLUMNS = {
  impressions: 2, // C
  clicks: 5, // F
  optins: 11, // L
  listIns: 13, // N
  cpc: 17, // R
  frontPurchase: 21, // V
  secretRoom: 24, // Y
  成約数: 27, // AB
  revenue: 34, // AI (④単月売上)
  optinLTV: 36, // AK
  individualRes: 38, // AM
  adSpend: 44, // AS (コスト税別)
} as const;

// スキルプラスのカラムマッピング（index）
const SP_COLUMNS = {
  impressions: 2, // C
  clicks: 5, // F
  optins: 7, // H
  listIns: 9, // J
  cpc: 12, // M
  seminarRes: 14, // O
  seminarAttend: 17, // R
  individualRes: 23, // X
  成約数: 25, // Z
  revenue: 26, // AA (着金売上)
  optinLTV: 28, // AC
  adSpend: 32, // AG (コスト税抜)
} as const;

// KPIカラム位置
const KPI_COLUMNS: Record<
  ChannelType,
  { itemCol: number; allowCol: number; targetCol: number }
> = {
  AI: { itemCol: 47, allowCol: 48, targetCol: 49 }, // AV, AW, AX
  SNS: { itemCol: 47, allowCol: 48, targetCol: 49 }, // AV, AW, AX
  SKILL_PLUS: { itemCol: 36, allowCol: 37, targetCol: 38 }, // AK, AL, AM
};

// KPI項目名のパース種別
const KPI_PERCENTAGE_ITEMS = [
  'ROAS',
  'オプト→フロント率',
  'フロント→個別率',
  '個別→着座率',
  '着座→成約率',
  'オプト→メイン',
  'メイン→企画',
  '企画→セミナー予約率',
  'セミナー予約→セミナー着座率',
  'セミナー着座→個別予約率',
  '個別予約→個別着座率',
  '個別着座→成約率',
];

const KPI_AMOUNT_ITEMS = [
  '商品単価',
  'バックCPO',
  '個別CPO',
  'フロントCPO',
  'セミナー着座CPO',
  'CPA',
  '目標粗利額',
];

@Injectable()
export class SpreadsheetMetricsDataSource implements MetricsDataSource {
  private readonly logger = new Logger(SpreadsheetMetricsDataSource.name);

  constructor(private readonly sheetsService: GoogleSheetsService) {}

  async getMonthlyMetrics(
    channelType: ChannelType,
    year: number,
    month: number,
  ): Promise<MonthlyMetricsData> {
    const sheetName = SHEET_NAMES[channelType];
    const cols = channelType === 'SKILL_PLUS' ? SP_COLUMNS : AI_SNS_COLUMNS;

    // シート全体のA列を読んで月ブロックの位置を特定
    const { summaryRow, dailyStartRow, dailyEndRow } =
      await this.findMonthBlock(sheetName, year, month);

    // 月集計行を取得
    const summaryData = await this.sheetsService.getValues(
      SPREADSHEET_ID,
      `'${sheetName}'!A${summaryRow}:AX${summaryRow}`,
    );
    const summaryRowData = summaryData[0] || [];

    // 日別データを取得
    const dailyRange = `'${sheetName}'!A${dailyStartRow}:AX${dailyEndRow}`;
    const dailyRows = await this.sheetsService.getValues(
      SPREADSHEET_ID,
      dailyRange,
    );

    const dailyData: DailyMetrics[] = [];
    for (const row of dailyRows) {
      const dateStr = (row[0] || '').trim();
      if (!dateStr || !/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(dateStr)) continue;

      const stageValues: Record<string, number> = {};
      if (channelType === 'SKILL_PLUS') {
        const spCols = cols as typeof SP_COLUMNS;
        stageValues['オプトイン'] = this.parseNum(row[spCols.optins]);
        stageValues['LINE登録'] = this.parseNum(row[spCols.listIns]);
        stageValues['セミナー予約'] = this.parseNum(row[spCols.seminarRes]);
        stageValues['セミナー着座'] = this.parseNum(row[spCols.seminarAttend]);
        stageValues['個別予約'] = this.parseNum(row[spCols.individualRes]);
        stageValues['成約数'] = this.parseNum(row[spCols['成約数']]);
      } else {
        stageValues['オプトイン'] = this.parseNum(row[cols.optins]);
        stageValues['LINE登録'] = this.parseNum(
          row[(cols as typeof AI_SNS_COLUMNS).listIns],
        );
        stageValues['フロント購入'] = this.parseNum(
          row[(cols as typeof AI_SNS_COLUMNS).frontPurchase],
        );
        stageValues['秘密の部屋購入'] = this.parseNum(
          row[(cols as typeof AI_SNS_COLUMNS).secretRoom],
        );
        stageValues['個別予約'] = this.parseNum(
          row[(cols as typeof AI_SNS_COLUMNS).individualRes],
        );
        stageValues['成約数'] = this.parseNum(
          row[(cols as typeof AI_SNS_COLUMNS)['成約数']],
        );
      }

      dailyData.push({
        date: dateStr,
        impressions: this.parseNum(row[cols.impressions]),
        clicks: this.parseNum(row[cols.clicks]),
        optins: this.parseNum(row[cols.optins]),
        adSpend: this.parseNum(row[cols.adSpend]),
        revenue: this.parseNum(row[cols.revenue]),
        cpc: this.parseNum(row[cols.cpc]),
        stageValues,
      });
    }

    // 月集計行からステージ別実績を取得
    const stageMetrics: Record<string, number> = {};
    stageMetrics['インプレッション'] = this.parseNum(
      summaryRowData[cols.impressions],
    );
    stageMetrics['クリック'] = this.parseNum(summaryRowData[cols.clicks]);

    if (channelType === 'SKILL_PLUS') {
      const spCols = cols as typeof SP_COLUMNS;
      stageMetrics['オプトイン'] = this.parseNum(summaryRowData[spCols.optins]);
      stageMetrics['LINE登録'] = this.parseNum(summaryRowData[spCols.listIns]);
      stageMetrics['セミナー予約'] = this.parseNum(
        summaryRowData[spCols.seminarRes],
      );
      stageMetrics['セミナー着座'] = this.parseNum(
        summaryRowData[spCols.seminarAttend],
      );
      stageMetrics['個別予約'] = this.parseNum(
        summaryRowData[spCols.individualRes],
      );
      stageMetrics['バックエンド購入'] = this.parseNum(
        summaryRowData[spCols['成約数']],
      );
    } else {
      stageMetrics['オプトイン'] = this.parseNum(summaryRowData[cols.optins]);
      stageMetrics['フロント購入'] = this.parseNum(
        summaryRowData[(cols as typeof AI_SNS_COLUMNS).frontPurchase],
      );
      stageMetrics['秘密の部屋購入'] = this.parseNum(
        summaryRowData[(cols as typeof AI_SNS_COLUMNS).secretRoom],
      );
      stageMetrics['LINE登録'] = this.parseNum(
        summaryRowData[(cols as typeof AI_SNS_COLUMNS).listIns],
      );
      stageMetrics['個別予約'] = this.parseNum(
        summaryRowData[(cols as typeof AI_SNS_COLUMNS).individualRes],
      );
      stageMetrics['バックエンド購入'] = this.parseNum(
        summaryRowData[(cols as typeof AI_SNS_COLUMNS)['成約数']],
      );
    }

    const adSpend = this.parseNum(summaryRowData[cols.adSpend]);
    const totalRevenue = this.parseNum(summaryRowData[cols.revenue]);
    const optinCount = stageMetrics['オプトイン'] || 0;
    const clickCount = stageMetrics['クリック'] || 0;
    const impressions = stageMetrics['インプレッション'] || 0;

    // optinLTV
    const optinLTVCol =
      channelType === 'SKILL_PLUS'
        ? SP_COLUMNS.optinLTV
        : AI_SNS_COLUMNS.optinLTV;
    const optinLTV = this.parseNum(summaryRowData[optinLTVCol]);

    return {
      channelType,
      year,
      month,
      adSpend,
      totalRevenue,
      optinCount,
      clickCount,
      impressions,
      optinLTV,
      stageMetrics,
      dailyData,
    };
  }

  async getKPI(
    channelType: ChannelType,
    year: number,
    month: number,
  ): Promise<KPITargets> {
    const sheetName = SHEET_NAMES[channelType];
    const kpiCols = KPI_COLUMNS[channelType];

    const { dailyStartRow, dailyEndRow } = await this.findMonthBlock(
      sheetName,
      year,
      month,
    );

    // 日別データ範囲の右側列を全部読む（KPIが埋め込まれている）
    const maxCol = this.indexToCol(
      Math.max(kpiCols.itemCol, kpiCols.targetCol) + 1,
    );
    const itemCol = this.indexToCol(kpiCols.itemCol);
    const range = `'${sheetName}'!${itemCol}${dailyStartRow}:${maxCol}${dailyEndRow}`;
    const rows = await this.sheetsService.getValues(SPREADSHEET_ID, range);

    const conversionRates: Record<string, number> = {};
    let targetROAS = 3.0;
    let avgPaymentAmount = 0;
    let cpa = 0;

    // KPI項目を読む
    // AI/SNSは「許容」「目標」ヘッダー行があるが、スキルプラスにはない
    // → ヘッダーがなくてもKPI項目名（ROAS等）を直接検出して読み取る
    const KPI_ITEM_NAMES = [
      'ROAS',
      '商品単価',
      'CPA',
      '目標粗利額',
      ...KPI_PERCENTAGE_ITEMS,
      ...KPI_AMOUNT_ITEMS,
    ];

    let kpiStarted = false;
    for (const row of rows) {
      const itemName = (row[0] || '').trim();
      const allowValue = (row[kpiCols.allowCol - kpiCols.itemCol] || '').trim();
      const targetValue = (
        row[kpiCols.targetCol - kpiCols.itemCol] || ''
      ).trim();

      if (!itemName) continue;

      // ヘッダー行の検出（AI/SNS用）
      if (allowValue === '許容' || targetValue === '目標') {
        kpiStarted = true;
        continue;
      }

      // ヘッダーがなくても、KPI項目名に一致すれば読み取り開始
      if (
        !kpiStarted &&
        KPI_ITEM_NAMES.some((k) => itemName === k || itemName.includes(k))
      ) {
        kpiStarted = true;
      }

      if (!kpiStarted) continue;

      // 許容値を使用（ボトルネック判定基準）
      if (itemName === 'ROAS') {
        targetROAS = parseKpiPercentage(allowValue);
      } else if (itemName.includes('商品単価')) {
        avgPaymentAmount = parseKpiAmount(allowValue);
      } else if (itemName === 'CPA') {
        cpa = parseKpiAmount(allowValue);
      } else if (itemName === '目標粗利額') {
        // 目標粗利額はgetTargetProfitで取得
        continue;
      } else if (KPI_PERCENTAGE_ITEMS.some((k) => itemName.includes(k))) {
        conversionRates[itemName] = parseKpiPercentage(allowValue);
      } else if (KPI_AMOUNT_ITEMS.some((k) => itemName.includes(k))) {
        // CPO系は金額だがボトルネック比較には転換率を使うのでスキップ
      }
    }

    return { conversionRates, targetROAS, avgPaymentAmount, cpa };
  }

  async getTargetProfit(
    channelType: ChannelType,
    year: number,
    month: number,
  ): Promise<number> {
    const sheetName = SHEET_NAMES[channelType];
    const kpiCols = KPI_COLUMNS[channelType];

    // 広い範囲でKPI列を検索（目標粗利額は月ブロック内のどこかにある）
    const allA = await this.sheetsService.getValues(
      SPREADSHEET_ID,
      `'${sheetName}'!A1:A600`,
    );

    // 対象月のブロック範囲
    const { dailyStartRow, dailyEndRow } = await this.findMonthBlock(
      sheetName,
      year,
      month,
    );

    // 対象月ブロック内＋前後のブロックでKPI列を検索
    const searchStart = Math.max(1, dailyStartRow - 35);
    const searchEnd = dailyEndRow;
    const itemCol = this.indexToCol(kpiCols.itemCol);
    const valCol = this.indexToCol(kpiCols.allowCol);
    const range = `'${sheetName}'!${itemCol}${searchStart}:${valCol}${searchEnd}`;
    const rows = await this.sheetsService.getValues(SPREADSHEET_ID, range);

    for (const row of rows) {
      const itemName = (row[0] || '').trim();
      if (itemName === '目標粗利額') {
        const value = (row[1] || '').trim();
        if (value) {
          return parseKpiAmount(value);
        }
      }
    }

    this.logger.warn(
      `目標粗利額が見つかりません: ${sheetName} ${year}年${month}月`,
    );
    return 0;
  }

  // =========================================================================
  // 内部ヘルパー
  // =========================================================================

  /** 指定年月の月ブロック位置を特定する */
  private async findMonthBlock(
    sheetName: string,
    year: number,
    month: number,
  ): Promise<{
    summaryRow: number;
    dailyStartRow: number;
    dailyEndRow: number;
  }> {
    const allA = await this.sheetsService.getValues(
      SPREADSHEET_ID,
      `'${sheetName}'!A1:A600`,
    );

    const monthLabel = `${month}月`;
    const targetDatePrefix = `${year}/${month}/`;
    const targetDatePrefix2 = `${year}/${String(month).padStart(2, '0')}/`;

    // 月ラベル行を全て収集
    const monthRows: number[] = [];
    for (let i = 0; i < allA.length; i++) {
      const val = (allA[i]?.[0] || '').trim();
      if (val === monthLabel) {
        monthRows.push(i + 1); // 1-indexed
      }
    }

    // 日付から正しい年の月ブロックを特定
    for (const summaryRow of monthRows) {
      const nextRow = summaryRow + 1;
      if (nextRow <= allA.length) {
        const nextVal = (allA[nextRow - 1]?.[0] || '').trim();
        if (
          nextVal.startsWith(targetDatePrefix) ||
          nextVal.startsWith(targetDatePrefix2)
        ) {
          // 日別データの終了行を探す（次の月ラベル or 返金行の手前）
          let dailyEndRow = summaryRow + 1;
          for (let i = summaryRow; i < allA.length; i++) {
            const val = (allA[i]?.[0] || '').trim();
            if (i > summaryRow && (val === '返金' || /^\d{1,2}月$/.test(val))) {
              dailyEndRow = i; // 1-indexed
              break;
            }
            dailyEndRow = i + 1;
          }

          return {
            summaryRow,
            dailyStartRow: summaryRow + 1,
            dailyEndRow: dailyEndRow - 1,
          };
        }
      }
    }

    throw new Error(
      `月ブロックが見つかりません: ${sheetName} ${year}年${month}月`,
    );
  }

  private parseNum(value: string | undefined): number {
    if (!value) return 0;
    const cleaned = String(value)
      .replace(/[¥,%％]/g, '')
      .replace(/,/g, '')
      .trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  private indexToCol(index: number): string {
    let result = '';
    let n = index;
    while (n >= 0) {
      result = String.fromCharCode((n % 26) + 65) + result;
      n = Math.floor(n / 26) - 1;
    }
    return result;
  }
}
