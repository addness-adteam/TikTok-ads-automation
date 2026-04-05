/**
 * profit-simulation ドメインロジックをローカル実行するスクリプト
 * NestJSのDIコンテナを使わず、SpreadsheetMetricsDataSourceを直接インスタンス化
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

// Google Sheets APIを直接使うための簡易アダプタ
const { google } = require('googleapis');

const SPREADSHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

// ドメインロジックのimport
import { calculateProfitSimulation, calculateTotalProfitSummary } from './src/profit-simulation/domain/profit-simulation';
import { judgeDirection, calculateRequiredAcquisition } from './src/profit-simulation/domain/direction-judgment';
import { detectBottlenecks } from './src/profit-simulation/domain/bottleneck-detection';
import { ChannelType, ProfitSimulation, MonthlyMetricsData, KPITargets } from './src/profit-simulation/domain/types';
import { parseKpiPercentage, parseKpiAmount, parseKpiValue } from './src/profit-simulation/infrastructure/kpi-value-parser';

// ===== Google Sheets直接アクセス =====
let sheetsClient: any;
async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

async function getValues(spreadsheetId: string, range: string): Promise<any[][]> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

// ===== SpreadsheetMetricsDataSourceの簡易再実装 =====
const SHEET_NAMES: Record<ChannelType, string> = {
  AI: 'AI', SNS: 'SNS', SKILL_PLUS: 'スキルプラス（オートウェビナー用）',
};

const AI_SNS_COLUMNS = {
  impressions: 2, clicks: 5, optins: 11, listIns: 13, cpc: 17, optCPA: 18,
  frontPurchase: 21, frontCPO: 23, secretRoom: 24, 成約数: 27,
  revenue: 34, optinLTV: 36, individualRes: 38, indResCPO: 40, adSpend: 44,
} as const;

const SP_COLUMNS = {
  impressions: 2, clicks: 5, optins: 7, listIns: 9, cpc: 12, optCPA: 13,
  seminarRes: 14, seminarAttend: 17, individualRes: 23, closings: 25,
  revenue: 26, optinLTV: 28, adSpend: 32,
} as const;

const KPI_COLUMNS: Record<ChannelType, { itemCol: number; allowCol: number; targetCol: number }> = {
  AI: { itemCol: 47, allowCol: 48, targetCol: 49 },
  SNS: { itemCol: 47, allowCol: 48, targetCol: 49 },
  SKILL_PLUS: { itemCol: 36, allowCol: 37, targetCol: 38 },
};

const KPI_PERCENTAGE_ITEMS = [
  'ROAS', 'オプト→フロント率', 'フロント→個別率', '個別→着座率', '着座→成約率',
  'オプト→メイン', 'メイン→企画', '企画→セミナー予約率',
  'セミナー予約→セミナー着座率', 'セミナー着座→個別予約率',
  '個別予約→個別着座率', '個別着座→成約率',
];
const KPI_AMOUNT_ITEMS = [
  '商品単価', 'バックCPO', '個別CPO', 'フロントCPO', 'セミナー着座CPO', 'CPA', '目標粗利額',
];

function parseNum(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  const s = String(val).replace(/[¥,%、,]/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

async function findMonthBlock(sheetName: string, year: number, month: number) {
  const rows = await getValues(SPREADSHEET_ID, `'${sheetName}'!A:A`);
  const monthStr = `${month}月`;
  let summaryRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const val = String(rows[i]?.[0] || '').trim();
    if (val === monthStr) { summaryRow = i + 1; break; }
  }
  if (summaryRow === -1) throw new Error(`${sheetName}に${monthStr}の集計行が見つかりません`);
  // 日別データは集計行の下から開始し、次の月 or 空行まで
  let dailyStartRow = summaryRow + 1;
  let dailyEndRow = dailyStartRow;
  for (let i = summaryRow; i < rows.length; i++) {
    const val = String(rows[i]?.[0] || '').trim();
    if (i > summaryRow && (val === '' || val.match(/^\d+月$/))) break;
    if (val.match(/^\d{4}\/\d{1,2}\/\d{1,2}$/)) dailyEndRow = i + 1;
  }
  return { summaryRow, dailyStartRow, dailyEndRow };
}

async function getMonthlyMetrics(channelType: ChannelType, year: number, month: number): Promise<MonthlyMetricsData> {
  const sheetName = SHEET_NAMES[channelType];
  const cols = channelType === 'SKILL_PLUS' ? SP_COLUMNS : AI_SNS_COLUMNS;
  const { summaryRow, dailyStartRow, dailyEndRow } = await findMonthBlock(sheetName, year, month);

  const summaryData = await getValues(SPREADSHEET_ID, `'${sheetName}'!A${summaryRow}:AX${summaryRow}`);
  const summaryRowData = summaryData[0] || [];

  const dailyRows = await getValues(SPREADSHEET_ID, `'${sheetName}'!A${dailyStartRow}:AX${dailyEndRow}`);

  const dailyData = dailyRows.filter(row => {
    const d = String(row[0] || '').trim();
    return /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(d);
  }).map(row => ({
    date: String(row[0]).trim(),
    impressions: parseNum(row[cols.impressions]),
    clicks: parseNum(row[cols.clicks]),
    optins: parseNum(row[cols.optins]),
    adSpend: parseNum(row[cols.adSpend]),
    revenue: parseNum(row[(cols as any).revenue || 34]),
    cpc: parseNum(row[cols.cpc]),
    stageValues: {} as Record<string, number>,
  }));

  // ステージ別実績
  const stageMetrics: Record<string, number> = {};
  stageMetrics['インプレッション'] = parseNum(summaryRowData[cols.impressions]);
  stageMetrics['クリック'] = parseNum(summaryRowData[cols.clicks]);
  stageMetrics['オプトイン'] = parseNum(summaryRowData[cols.optins]);
  stageMetrics['LINE登録'] = parseNum(summaryRowData[cols.listIns]);

  if (channelType === 'SKILL_PLUS') {
    const sp = cols as typeof SP_COLUMNS;
    stageMetrics['セミナー予約'] = parseNum(summaryRowData[sp.seminarRes]);
    stageMetrics['セミナー着座'] = parseNum(summaryRowData[sp.seminarAttend]);
    stageMetrics['個別予約'] = parseNum(summaryRowData[sp.individualRes]);
    stageMetrics['バックエンド購入'] = parseNum(summaryRowData[sp.closings]);
  } else {
    const ai = cols as typeof AI_SNS_COLUMNS;
    stageMetrics['フロント購入'] = parseNum(summaryRowData[ai.frontPurchase]);
    stageMetrics['秘密の部屋購入'] = parseNum(summaryRowData[ai.secretRoom]);
    stageMetrics['個別予約'] = parseNum(summaryRowData[ai.individualRes]);
    stageMetrics['バックエンド購入'] = parseNum(summaryRowData[ai['成約数']]);
  }

  return {
    channelType, year, month,
    adSpend: parseNum(summaryRowData[cols.adSpend]),
    totalRevenue: parseNum(summaryRowData[(cols as any).revenue || 34]),
    optinCount: parseNum(summaryRowData[cols.optins]),
    clickCount: parseNum(summaryRowData[cols.clicks]),
    impressions: parseNum(summaryRowData[cols.impressions]),
    optinLTV: parseNum(summaryRowData[(cols as any).optinLTV || 36]),
    stageMetrics,
    dailyData,
  };
}

async function getKPI(channelType: ChannelType, year: number, month: number): Promise<KPITargets> {
  const sheetName = SHEET_NAMES[channelType];
  const kpiCols = KPI_COLUMNS[channelType];
  const rows = await getValues(SPREADSHEET_ID, `'${sheetName}'!A:AZ`);

  const conversionRates: Record<string, number> = {};
  let targetROAS = 0, avgPaymentAmount = 0, cpa = 0;

  // KPIセクションを探す（月集計行の下部、KPI項目列に値がある行）
  for (const row of rows) {
    const itemName = String(row[kpiCols.itemCol] || '').trim();
    const allowVal = String(row[kpiCols.allowCol] || '').trim();
    if (!itemName || !allowVal) continue;

    if (KPI_PERCENTAGE_ITEMS.includes(itemName)) {
      const v = parseKpiPercentage(allowVal);
      if (v !== null) conversionRates[itemName] = v;
    } else if (KPI_AMOUNT_ITEMS.includes(itemName)) {
      const v = parseKpiAmount(allowVal);
      if (v !== null) {
        if (itemName === '商品単価') avgPaymentAmount = v;
        if (itemName === 'CPA') cpa = v;
      }
    } else if (itemName === 'ROAS') {
      const v = parseKpiPercentage(allowVal);
      if (v !== null) targetROAS = v;
    }
  }

  return { conversionRates, targetROAS, avgPaymentAmount, cpa };
}

async function getTargetProfit(channelType: ChannelType, year: number, month: number): Promise<number> {
  const sheetName = SHEET_NAMES[channelType];
  const kpiCols = KPI_COLUMNS[channelType];
  const rows = await getValues(SPREADSHEET_ID, `'${sheetName}'!A:AZ`);

  for (const row of rows) {
    const itemName = String(row[kpiCols.itemCol] || '').trim();
    if (itemName === '目標粗利額') {
      // allow列(許容値)に入っている（target列は空のことが多い）
      const allowVal = String(row[kpiCols.allowCol] || '').trim();
      const targetVal = String(row[kpiCols.targetCol] || '').trim();
      const val = targetVal || allowVal;
      if (val) return parseKpiAmount(val) || 0;
    }
  }
  return 0;
}

// ===== メイン =====
async function main() {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const year = jstNow.getUTCFullYear();
  const month = jstNow.getUTCMonth() + 1;
  const dayOfMonth = jstNow.getUTCDate();
  const totalDaysInMonth = new Date(year, month, 0).getDate();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  利益シミュレーション & ボトルネック特定`);
  console.log(`  ${year}年${month}月 (${dayOfMonth}/${totalDaysInMonth}日経過)`);
  console.log(`${'='.repeat(60)}`);

  const ALL_CHANNELS: ChannelType[] = ['AI', 'SNS', 'SKILL_PLUS'];
  const channelResults: ProfitSimulation[] = [];

  for (const channelType of ALL_CHANNELS) {
    try {
      // Step 1: 現状数値取得
      console.log(`\n── [${channelType}] Step 1: 数値取得 ──`);
      const metrics = await getMonthlyMetrics(channelType, year, month);
      const kpi = await getKPI(channelType, year, month);
      const targetProfit = await getTargetProfit(channelType, year, month);

      console.log(`  広告費: ¥${metrics.adSpend.toLocaleString()}, 売上: ¥${metrics.totalRevenue.toLocaleString()}, 粗利: ¥${(metrics.totalRevenue - metrics.adSpend).toLocaleString()}`);
      console.log(`  オプト: ${metrics.optinCount}, クリック: ${metrics.clickCount}, CPC: ¥${metrics.clickCount > 0 ? (metrics.adSpend / metrics.clickCount).toFixed(0) : '-'}`);
      console.log(`  目標粗利: ¥${targetProfit.toLocaleString()}`);

      // ステージ実績
      console.log(`  ステージ実績:`);
      for (const [stage, count] of Object.entries(metrics.stageMetrics)) {
        console.log(`    ${stage}: ${count}`);
      }

      // KPI許容値
      console.log(`  KPI許容値:`);
      for (const [name, rate] of Object.entries(kpi.conversionRates)) {
        console.log(`    ${name}: ${(rate * 100).toFixed(1)}%`);
      }

      // Step 2: シミュレーション
      console.log(`\n── [${channelType}] Step 2: シミュレーション ──`);
      const actualDays = metrics.dailyData.filter(d => d.adSpend > 0 || d.optins > 0).length || dayOfMonth;
      const simulation = calculateProfitSimulation({
        channelType, year, month, actualDays, totalDaysInMonth,
        actualAdSpend: metrics.adSpend, actualRevenue: metrics.totalRevenue,
        targetProfit,
      });
      channelResults.push(simulation);
      console.log(`  実績粗利: ¥${simulation.actualProfit.toLocaleString()} (${actualDays}日)`);
      console.log(`  月末推定粗利: ¥${simulation.projectedProfit.toLocaleString()}`);
      console.log(`  目標粗利: ¥${simulation.targetProfit.toLocaleString()} → ${simulation.isOnTrack ? '✅ 達成見込み' : `❌ 未達 (差額 ¥${simulation.gapToTarget.toLocaleString()})`}`);

      // Step 3-4: 方向判定
      console.log(`\n── [${channelType}] Step 3-4: 改善方向 ──`);
      const cpa = metrics.optinCount > 0 ? metrics.adSpend / metrics.optinCount : 0;
      const requiredAcquisition = calculateRequiredAcquisition(targetProfit, metrics.optinLTV, cpa);
      const targetROAS = metrics.adSpend > 0
        ? (targetProfit + simulation.projectedAdSpend) / simulation.projectedAdSpend
        : kpi.targetROAS;
      const currentROAS = metrics.adSpend > 0 ? metrics.totalRevenue / metrics.adSpend : 0;
      const judgment = judgeDirection({ currentROAS, targetROAS, currentAcquisition: metrics.optinCount, requiredAcquisition });
      console.log(`  ROAS: 現状 ${(currentROAS * 100).toFixed(0)}% vs 目標 ${(targetROAS * 100).toFixed(0)}%`);
      console.log(`  集客: 現状 ${metrics.optinCount}人 vs 必要 ${isFinite(requiredAcquisition) ? requiredAcquisition : '∞'}人`);
      console.log(`  判定: ${judgment.direction} — ${judgment.reason}`);

      // Step 5-6: ボトルネック特定
      console.log(`\n── [${channelType}] Step 5-6: ボトルネック ──`);
      const bottlenecks = detectBottlenecks(channelType, metrics.stageMetrics, kpi);
      if (bottlenecks.length === 0) {
        console.log(`  ボトルネックなし（全KPI許容値以内）`);
      } else {
        for (const b of bottlenecks) {
          console.log(`  #${b.rank} ${b.stage}: 現状 ${(b.currentRate * 100).toFixed(1)}% vs 許容 ${(b.targetRate * 100).toFixed(1)}% (差 ${b.gapPoints}pt) → 粗利インパクト ¥${b.profitImpact.toLocaleString()}`);
        }
      }

    } catch (e: any) {
      console.error(`  [${channelType}] エラー: ${e.message}`);
    }
  }

  // 全体サマリー
  const summary = calculateTotalProfitSummary(channelResults, { year, month });
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  全体サマリー`);
  console.log(`  実績粗利合計: ¥${summary.totalActualProfit.toLocaleString()}`);
  console.log(`  月末推定粗利: ¥${summary.totalProjectedProfit.toLocaleString()}`);
  console.log(`  目標粗利合計: ¥${summary.totalTargetProfit.toLocaleString()}`);
  console.log(`  達成見込み: ${summary.isOnTrack ? '✅' : '❌'}`);
  console.log(`${'='.repeat(60)}`);
}

main().catch(err => { console.error('エラー:', err); process.exit(1); });
