/**
 * 日次運用OS - Todo自動生成スクリプト
 *
 * 使い方: npx tsx apps/backend/daily-ops-todo.ts
 *
 * 分析項目:
 *   ① 過去CRの再出稿候補（個別予約CPO≦KPI or ROAS≧300%の停止CR）
 *   ② 勝ちCRの横展開候補（KPI達成＋CV数多い配信中CR）
 *   ③ 停止CR分析（最近停止されたCRの数値と改善案）
 *   ④ 時間帯分析（成績の良い時間帯の把握）
 *   ⑤ LP別CVR比較（同じCRでLP別の成績差）
 *   ⑥ Smart+化提案（同導線で勝ちCR6本以上あるか）
 *   ⑦ 前日個別予約CPOチェック（個別予約シートから直接算出→再出稿判断）
 *   ⑨ 利益シミュレーション & ボトルネック特定（profit-simulationドメインロジック）
 *   ⑩ 停止CR自動効果測定（ad-evaluationドメインロジック）
 *
 * ルールファイル: daily-ops-rules.md にFBベースの思考ルールを蓄積
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const DAILY_REPORT_SHEET_ID = '17PWEALugoIY2aKtjpITuyEAwJRz7o03q5iLeR5_5FwM';
const INDIVIDUAL_RESERVATION_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

// KPI閾値（DBから取得するが、フォールバック用）
const KPI = {
  'AI': { allowableCPA: 4032, allowableFrontCPO: 39378, allowableIndResCPO: 53795 },
  'SNS': { allowableCPA: 2499, allowableFrontCPO: 31637, allowableIndResCPO: 37753 },
  'スキルプラス': { allowableCPA: 6000, allowableFrontCPO: null, allowableIndResCPO: 48830 },
};

// アカウントと導線の対応
const ACCOUNT_APPEAL: Record<string, string> = {
  '7468288053866561553': 'AI',    // AI_1
  '7523128243466551303': 'AI',    // AI_2
  '7543540647266074641': 'AI',    // AI_3
  '7580666710525493255': 'AI',    // AI_4
  '7247073333517238273': 'SNS',   // SNS1
  '7543540100849156112': 'SNS',   // SNS2
  '7543540381615800337': 'SNS',   // SNS3
  '7474920444831875080': 'スキルプラス', // SP1
  '7592868952431362066': 'スキルプラス', // SP2
  '7616545514662051858': 'スキルプラス', // SP3
};

const ACCOUNT_NAMES: Record<string, string> = {
  '7468288053866561553': 'AI_1',
  '7523128243466551303': 'AI_2',
  '7543540647266074641': 'AI_3',
  '7580666710525493255': 'AI_4',
  '7247073333517238273': 'SNS1',
  '7543540100849156112': 'SNS2',
  '7543540381615800337': 'SNS3',
  '7474920444831875080': 'SP1',
  '7592868952431362066': 'SP2',
  '7616545514662051858': 'SP3',
};

// 個別予約シートの設定
const RESERVATION_SHEET_CONFIG: Record<string, { sheetName: string; dateCol: number; pathCol: number }> = {
  'AI': { sheetName: 'AI', dateCol: 0, pathCol: 46 },
  'SNS': { sheetName: 'SNS', dateCol: 0, pathCol: 46 },
  'スキルプラス': { sheetName: 'スキルプラス（オートウェビナー用）', dateCol: 0, pathCol: 34 },
};

const prisma = new PrismaClient();

// ===== ルールファイル読み込み =====
interface OpsRule {
  id: string;
  category: string;
  rule: string;
  condition?: string;
  action?: string;
}

function loadRules(): OpsRule[] {
  const rulesPath = path.join(__dirname, 'daily-ops-rules.md');
  if (!fs.existsSync(rulesPath)) return [];

  const content = fs.readFileSync(rulesPath, 'utf-8');
  const rules: OpsRule[] = [];

  // ```rule ブロックをパース
  const ruleBlocks = content.match(/```rule\n([\s\S]*?)```/g) || [];
  for (const block of ruleBlocks) {
    const inner = block.replace(/```rule\n/, '').replace(/```$/, '').trim();
    try {
      const parsed = JSON.parse(inner);
      rules.push(parsed);
    } catch {
      // パース失敗は無視
    }
  }

  return rules;
}

// ===== Google Sheets =====
async function getSheetsClient() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  return google.sheets({ version: 'v4', auth });
}

async function readSheet(sheets: any, spreadsheetId: string, range: string): Promise<any[][]> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

// ===== スプシからCV/フロント販売/個別予約を取得（UTAGE経由） =====

// 導線ごとのスプシURL（DBのAppealテーブルから）
const APPEAL_SHEETS: Record<string, { cvSheetId: string; frontSheetId: string }> = {
  'AI': {
    cvSheetId: '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk',
    frontSheetId: '1PvyM6JkFuQR_lc4QyZFaMX0GA0Rn0_6Bll9mjh0RNFs',
  },
  'SNS': {
    cvSheetId: '1JlEC8rQAM3h2E7GuUplMPrLyVdA5Q3nZ0lGneC2nZvY',
    frontSheetId: '14xhgh-Ad-Ont1wK-L4ZOyS8KgIfvoQX7zUGImH5hwKU',
  },
  'スキルプラス': {
    cvSheetId: '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk',
    frontSheetId: '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk',
  },
};

/** スプシから登録経路ベースのカウントを取得（TT_オプト or TT【OTO】/TT【3day】） */
async function countFromSheet(
  sheets: any,
  spreadsheetId: string,
  sheetNames: string[],
  registrationPaths: string[],
  startDate: Date,
  endDate: Date,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (const p of registrationPaths) result.set(p, 0);

  for (const sheetName of sheetNames) {
    try {
      const rows = await readSheet(sheets, spreadsheetId, `${sheetName}!A:Z`);
      if (rows.length < 2) continue;

      // ヘッダーから登録経路列と日付列を自動検出
      const header = rows[0].map((h: string) => String(h || '').trim());
      let pathCol = header.findIndex((h: string) =>
        ['登録経路', '流入経路', 'registration_path', 'path', 'ファネル登録経路'].includes(h));
      let dateCol = header.findIndex((h: string) =>
        ['登録日時', '登録日', 'date', 'created_at', 'timestamp', 'アクション実行日時', '実行日時'].includes(h));

      // フォールバック: E列=4(path), F列=5(date)
      if (pathCol < 0) pathCol = 4;
      if (dateCol < 0) dateCol = 5;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const dateStr = String(row[dateCol] || '').trim();
        const pathStr = String(row[pathCol] || '').trim();
        if (!dateStr || !pathStr) continue;

        // 日付パース（JST）
        const slashMatch = dateStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
        if (!slashMatch) continue;
        const rowDate = new Date(Date.UTC(
          parseInt(slashMatch[1]), parseInt(slashMatch[2]) - 1, parseInt(slashMatch[3]), -9, 0, 0,
        ));
        if (rowDate < startDate || rowDate > endDate) continue;

        // パスマッチ（前方一致: TikTok広告-AI-LP1 がTikTok広告-AI-LP1-CR00XXXにもマッチ）
        for (const targetPath of registrationPaths) {
          if (pathStr === targetPath || pathStr.startsWith(targetPath + '-') || pathStr.startsWith(targetPath + '/')) {
            result.set(targetPath, (result.get(targetPath) || 0) + 1);
          }
        }
      }
    } catch (e) {
      // シート読み取りエラーは無視（シートが存在しない場合等）
    }
  }
  return result;
}

interface AccountUTAGEMetrics {
  account: string;
  appeal: string;
  cvCount: number;        // UTAGEオプト数
  frontSales: number;     // フロント販売数
  indResCount: number;    // 個別予約数
  adCount: number;        // 配信中広告数
  crPaths: Map<string, { cv: number; front: number; indRes: number; adNames: string[] }>;
}

/** アカウント単位でスプシからCV/フロント/個別予約を集計 */
async function getAccountUTAGEMetrics(sheets: any, ads: any[]): Promise<AccountUTAGEMetrics[]> {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const endDate = new Date(`${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(jstNow.getUTCDate()).padStart(2, '0')}T23:59:59+09:00`);
  const startDate7 = new Date(endDate.getTime() - 7 * 86400000);

  // アカウントごとに LP-CR レベルの登録経路を集計
  // キー: TikTok広告-AI-LP1-CR01047 のようなCR番号込みのパス
  // 注: 個別予約は停止済みCRにも入るため、全広告を対象にする（statusフィルタなし）
  // adCountだけは配信中のみカウント
  const accountData = new Map<string, { appeal: string; crRegPaths: Map<string, string[]>; activeAdCount: number }>();

  for (const ad of ads) {
    const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId || '';
    const appeal = ACCOUNT_APPEAL[advId];
    if (!appeal) continue;

    const adName = ad.name || '';
    const lpCr = extractLPCRFromAdName(adName);
    if (!lpCr) continue;

    // CR番号込みの登録経路: TikTok広告-AI-LP1-CR01047
    const crRegPath = `TikTok広告-${appeal}-${lpCr}`;

    if (!accountData.has(advId)) accountData.set(advId, { appeal, crRegPaths: new Map(), activeAdCount: 0 });
    const data = accountData.get(advId)!;
    if (!data.crRegPaths.has(crRegPath)) data.crRegPaths.set(crRegPath, []);
    data.crRegPaths.get(crRegPath)!.push(adName);
    if (ad.status === 'ENABLE') data.activeAdCount++;
  }

  const results: AccountUTAGEMetrics[] = [];

  // 導線ごとにスプシデータを一括読み込みしてキャッシュ
  // キー: sheetId:sheetName → 全行データ
  const rawDataCache = new Map<string, any[][]>();

  async function getRawData(sheetId: string, sheetName: string): Promise<any[][]> {
    const cacheKey = `${sheetId}:${sheetName}`;
    if (rawDataCache.has(cacheKey)) return rawDataCache.get(cacheKey)!;
    try {
      const rows = await readSheet(sheets, sheetId, `${sheetName}!A:Z`);
      rawDataCache.set(cacheKey, rows);
      return rows;
    } catch {
      rawDataCache.set(cacheKey, []);
      return [];
    }
  }

  /** 生データからCR登録経路に完全一致するカウントを取得 */
  function countExactPaths(rows: any[][], targetPaths: Set<string>, startD: Date, endD: Date): Map<string, number> {
    const result = new Map<string, number>();
    if (rows.length < 2) return result;

    // ヘッダーから列を自動検出
    const header = rows[0].map((h: string) => String(h || '').trim());
    let pathCol = header.findIndex((h: string) =>
      ['登録経路', '流入経路', 'registration_path', 'path', 'ファネル登録経路'].includes(h));
    let dateCol = header.findIndex((h: string) =>
      ['登録日時', '登録日', 'date', 'created_at', 'timestamp', 'アクション実行日時', '実行日時'].includes(h));
    if (pathCol < 0) pathCol = 4;
    if (dateCol < 0) dateCol = 5;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const dateStr = String(row[dateCol] || '').trim();
      const pathStr = String(row[pathCol] || '').trim();
      if (!dateStr || !pathStr) continue;

      const slashMatch = dateStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
      if (!slashMatch) continue;
      const rowDate = new Date(Date.UTC(parseInt(slashMatch[1]), parseInt(slashMatch[2]) - 1, parseInt(slashMatch[3]), -9, 0, 0));
      if (rowDate < startD || rowDate > endD) continue;

      // 完全一致 or CR番号なしのLP一致もカウント（TT_オプトはCR番号込み）
      if (targetPaths.has(pathStr)) {
        result.set(pathStr, (result.get(pathStr) || 0) + 1);
      }
    }
    return result;
  }

  for (const [advId, data] of accountData) {
    const appealSheets = APPEAL_SHEETS[data.appeal];
    if (!appealSheets) continue;

    const accName = ACCOUNT_NAMES[advId];
    const targetPaths = new Set(data.crRegPaths.keys());
    const crPaths = new Map<string, { cv: number; front: number; indRes: number; adNames: string[] }>();
    for (const [p, names] of data.crRegPaths) {
      crPaths.set(p, { cv: 0, front: 0, indRes: 0, adNames: names });
    }

    // CV取得（TT_オプト）
    const cvRows = await getRawData(appealSheets.cvSheetId, 'TT_オプト');
    const cvCounts = countExactPaths(cvRows, targetPaths, startDate7, endDate);

    // フロント販売取得
    const otoRows = await getRawData(appealSheets.frontSheetId, 'TT【OTO】');
    const dayRows = await getRawData(appealSheets.frontSheetId, 'TT【3day】');
    const frontOTO = countExactPaths(otoRows, targetPaths, startDate7, endDate);
    const front3day = countExactPaths(dayRows, targetPaths, startDate7, endDate);

    // 個別予約取得 — LP-CRを抽出してマッチ（完全一致ではなくLP-CR部分一致に変更）
    const resConfig = RESERVATION_SHEET_CONFIG[data.appeal];
    const indResCounts = new Map<string, number>();
    if (resConfig) {
      // targetPathsからLP-CR → 登録経路の逆引きマップを作成
      const lpCrToRegPath = new Map<string, string>();
      for (const tp of targetPaths) {
        const m = tp.match(/(LP\d+-CR\d+)/i);
        if (m) lpCrToRegPath.set(m[1].toUpperCase(), tp);
      }

      const resRows = await getRawData(INDIVIDUAL_RESERVATION_SHEET_ID, resConfig.sheetName);
      for (let i = 1; i < resRows.length; i++) {
        const row = resRows[i];
        const dateStr = String(row[resConfig.dateCol] || '').trim();
        const pathValue = row[resConfig.pathCol];
        if (!dateStr || !pathValue) continue;

        const slashMatch = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
        if (!slashMatch) continue;
        const rowDate = new Date(Date.UTC(parseInt(slashMatch[1]), parseInt(slashMatch[2]) - 1, parseInt(slashMatch[3]), -9, 0, 0));
        if (rowDate < startDate7 || rowDate > endDate) continue;

        const lines = String(pathValue).split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          // LP-CRを抽出してマッチ
          const lpCrMatch = trimmed.match(/(LP\d+-CR\d+)/i);
          if (lpCrMatch) {
            const lpCr = lpCrMatch[1].toUpperCase();
            const regPath = lpCrToRegPath.get(lpCr);
            if (regPath) {
              indResCounts.set(regPath, (indResCounts.get(regPath) || 0) + 1);
            }
          }
        }
      }
    }

    let totalCV = 0, totalFront = 0, totalIndRes = 0;
    for (const [regPath, crData] of crPaths) {
      crData.cv = cvCounts.get(regPath) || 0;
      crData.front = (frontOTO.get(regPath) || 0) + (front3day.get(regPath) || 0);
      crData.indRes = indResCounts.get(regPath) || 0;
      totalCV += crData.cv;
      totalFront += crData.front;
      totalIndRes += crData.indRes;
    }

    results.push({
      account: accName,
      appeal: data.appeal,
      cvCount: totalCV,
      frontSales: totalFront,
      indResCount: totalIndRes,
      adCount: data.activeAdCount,
      crPaths,
    });
  }

  return results;
}

// ===== TikTok API =====
async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

// ===== データ取得 =====

/** 日次レポートシートから直近のCR成績を取得 */
async function getDailyReportData(sheets: any): Promise<any[]> {
  const rows = await readSheet(sheets, DAILY_REPORT_SHEET_ID, 'シート1!A:S');
  if (rows.length < 2) return [];

  // ヘッダー: 日付,アカウント,導線,広告名,日予算,予算アクション,新予算,当日CPA,当日CV,当日広告費,7日CPA,7日フロントCPO,7日個別予約CPO,7日広告費,7日CV,7日フロント販売数,7日個別予約数,停止判定,判定理由
  const data = rows.slice(1).map(row => ({
    date: row[0] || '',
    account: row[1] || '',
    appeal: row[2] || '',
    adName: row[3] || '',
    dailyBudget: parseFloat((row[4] || '0').replace(/[¥,]/g, '')) || 0,
    action: row[5] || '',
    newBudget: row[6] || '',
    todayCPA: parseFloat((row[7] || '0').replace(/[¥,]/g, '')) || 0,
    todayCV: parseInt(row[8] || '0') || 0,
    todaySpend: parseFloat((row[9] || '0').replace(/[¥,]/g, '')) || 0,
    sevenDayCPA: parseFloat((row[10] || '0').replace(/[¥,]/g, '')) || 0,
    sevenDayFrontCPO: parseFloat((row[11] || '0').replace(/[¥,]/g, '')) || 0,
    sevenDayIndResCPO: parseFloat((row[12] || '0').replace(/[¥,]/g, '')) || 0,
    sevenDaySpend: parseFloat((row[13] || '0').replace(/[¥,]/g, '')) || 0,
    sevenDayCV: parseInt(row[14] || '0') || 0,
    sevenDayFrontSales: parseInt(row[15] || '0') || 0,
    sevenDayIndRes: parseInt(row[16] || '0') || 0,
    pauseDecision: row[17] || '',
    reason: row[18] || '',
  }));

  return data;
}

/** DBから現在の広告情報を取得 */
async function getAdsFromDB() {
  return prisma.ad.findMany({
    where: { adGroup: { campaign: { advertiser: { tiktokAdvertiserId: { in: Object.keys(ACCOUNT_APPEAL) } } } } },
    select: {
      tiktokId: true,
      name: true,
      status: true,
      adGroup: {
        select: {
          budget: true,
          campaign: {
            select: {
              advertiser: { select: { tiktokAdvertiserId: true, name: true } },
            },
          },
        },
      },
    },
  });
}

// ===== 分析ロジック =====

interface TodoItem {
  category: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  action: string;
  detail: string;
  adName?: string;
  adId?: string;
  account?: string;
  metrics?: Record<string, any>;
}

/** 個別予約シートから直近の個別予約をLP-CRキーで取得（⑦と同じデータソース） */
async function getRecentIndividualReservations(sheets: any, checkDays: number = 7): Promise<Map<string, number>> {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const startDate = new Date(jstNow);
  startDate.setUTCDate(startDate.getUTCDate() - checkDays);
  const rangeStart = new Date(`${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}-${String(startDate.getUTCDate()).padStart(2, '0')}T00:00:00+09:00`);
  const rangeEnd = new Date(`${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(jstNow.getUTCDate()).padStart(2, '0')}T23:59:59+09:00`);

  const result = new Map<string, number>();
  for (const [appeal, config] of Object.entries(RESERVATION_SHEET_CONFIG)) {
    try {
      const rows = await readSheet(sheets, INDIVIDUAL_RESERVATION_SHEET_ID, `${config.sheetName}!A:AZ`);
      if (rows.length < 2) continue;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const dateValue = row[config.dateCol];
        const pathValue = row[config.pathCol];
        if (!dateValue || !pathValue) continue;
        const dateStr = String(dateValue).trim();
        const slashMatch = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
        if (!slashMatch) continue;
        const rowDate = new Date(Date.UTC(parseInt(slashMatch[1]), parseInt(slashMatch[2]) - 1, parseInt(slashMatch[3]), -9, 0, 0));
        if (rowDate < rangeStart || rowDate > rangeEnd) continue;
        const lines = String(pathValue).split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const lpCrMatch = trimmed.match(/(LP\d+-CR\d+)/i);
          if (!lpCrMatch) continue;
          const lpCr = lpCrMatch[1].toUpperCase();
          result.set(lpCr, (result.get(lpCr) || 0) + 1);
        }
      }
    } catch (e) {
      // シート読み取りエラーは無視
    }
  }
  return result;
}

/** ① 過去CRの再出稿候補 */
function analyzeRedeployCandidates(reportData: any[], ads: any[], indResMap?: Map<string, number>): TodoItem[] {
  const todos: TodoItem[] = [];

  // 停止されたCRを特定（PAUSEアクションがあり、かつ成績が良かったもの）
  const pausedCRs = new Map<string, any>();

  for (const row of reportData) {
    if (row.action === 'PAUSE' || row.pauseDecision === 'PAUSE') {
      const key = `${row.account}:${row.adName}`;
      if (!pausedCRs.has(key)) {
        pausedCRs.set(key, row);
      }
    }
  }

  // 停止CR の中から、過去に良い成績を出していたものを探す
  const crPerformance = new Map<string, any[]>();
  for (const row of reportData) {
    const key = `${row.account}:${row.adName}`;
    if (!crPerformance.has(key)) crPerformance.set(key, []);
    crPerformance.get(key)!.push(row);
  }

  for (const [key, pauseRow] of pausedCRs) {
    const history = crPerformance.get(key) || [];
    const appeal = pauseRow.appeal as keyof typeof KPI;
    const kpi = KPI[appeal];
    if (!kpi) continue;

    // 良い成績があったかチェック（個別予約はシート直接読みの値も考慮）
    const lpCrForFilter = extractLPCRFromAdName(pauseRow.adName);
    const sheetIndResForFilter = lpCrForFilter && indResMap ? (indResMap.get(lpCrForFilter) || 0) : 0;
    const goodDays = history.filter(row => {
      if (row.sevenDayCV === 0) return false;
      // 個別予約CPOがKPI以内（シート直接読みの値も考慮）
      const rowIndRes = Math.max(row.sevenDayIndRes, sheetIndResForFilter);
      if (rowIndRes > 0 && row.sevenDayIndResCPO > 0 && row.sevenDayIndResCPO <= kpi.allowableIndResCPO) return true;
      if (rowIndRes > 0 && row.sevenDaySpend > 0 && (row.sevenDaySpend / rowIndRes) <= kpi.allowableIndResCPO) return true;
      // フロントCPOがKPI以内（SNS/AIのみ）
      if (kpi.allowableFrontCPO && row.sevenDayFrontSales > 0 && row.sevenDayFrontCPO > 0 && row.sevenDayFrontCPO <= kpi.allowableFrontCPO) return true;
      // CPAが許容値以内かつCV数が多い
      if (row.sevenDayCPA > 0 && row.sevenDayCPA <= kpi.allowableCPA && row.sevenDayCV >= 3) return true;
      return false;
    });

    if (goodDays.length > 0) {
      const bestDay = goodDays.sort((a, b) => (b.sevenDayCV - a.sevenDayCV))[0];
      const crMatch = pauseRow.adName.match(/CR(\d+)/);
      const crNum = crMatch ? crMatch[1] : '?';

      // 個別予約シートから直接取得した値で補正（V2レポートの値が0でもシートに実績がある場合）
      const lpCr = extractLPCRFromAdName(pauseRow.adName);
      const sheetIndRes = lpCr && indResMap ? (indResMap.get(lpCr) || 0) : 0;
      const effectiveIndRes = Math.max(bestDay.sevenDayIndRes, sheetIndRes);

      // DBから広告IDを検索
      const ad = ads.find(a => a.name === pauseRow.adName);
      const adId = ad?.tiktokId || '';

      // 枯れチェック: 同じCR名で直近3日以内に出稿→即停止されていたら枯れている可能性
      const crNameParts = pauseRow.adName.split('/');
      const crCoreName = crNameParts.length >= 3 ? `${crNameParts[1]}/${crNameParts[2]}` : '';
      const recentDates3 = [...new Set(reportData.map(r => r.date))].sort().reverse().slice(0, 3);
      const recentSameCreative = reportData.filter(r =>
        recentDates3.includes(r.date) &&
        r.adName.includes(crCoreName) &&
        (r.action === 'PAUSE' || r.pauseDecision === 'PAUSE') &&
        r.sevenDayCV <= 1,
      );
      const isStale = recentSameCreative.length > 0;

      if (isStale) {
        todos.push({
          category: '① 再出稿',
          priority: 'MEDIUM',
          action: `CR${crNum}: 枯れの可能性あり → 動画ID変更 or 別アカウントで出稿を検討`,
          detail: `直近で同CRが0〜1CV停止。過去実績: 7日CV=${bestDay.sevenDayCV}, CPA=¥${bestDay.sevenDayCPA.toFixed(0)}。別アカウントまたはフック差し替えで再テスト推奨`,
          adName: pauseRow.adName,
          adId,
          account: pauseRow.account,
          metrics: { cv: bestDay.sevenDayCV, cpa: bestDay.sevenDayCPA, indRes: effectiveIndRes, isStale: true },
        });
      } else {
        todos.push({
          category: '① 再出稿',
          priority: effectiveIndRes > 0 ? 'HIGH' : 'MEDIUM',
          action: `CR${crNum}を${pauseRow.account}に再出稿`,
          detail: `過去実績: 7日CV=${bestDay.sevenDayCV}, CPA=¥${bestDay.sevenDayCPA.toFixed(0)}, 個別予約=${effectiveIndRes}件${bestDay.sevenDayIndResCPO > 0 ? ` (CPO ¥${bestDay.sevenDayIndResCPO.toFixed(0)})` : ''}`,
          adName: pauseRow.adName,
          adId,
          account: pauseRow.account,
          metrics: { cv: bestDay.sevenDayCV, cpa: bestDay.sevenDayCPA, indRes: effectiveIndRes, indResCPO: bestDay.sevenDayIndResCPO },
        });
      }
    }
  }

  // 優先度とCV数でソート
  return todos.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'HIGH' ? -1 : 1;
    return (b.metrics?.cv || 0) - (a.metrics?.cv || 0);
  });
}

/** ② 横展開候補 */
function analyzeCrossDeployCandidates(reportData: any[], ads: any[], indResMap?: Map<string, number>): TodoItem[] {
  const todos: TodoItem[] = [];

  // 直近データの日付を取得
  const dates = [...new Set(reportData.map(r => r.date))].sort().reverse();
  const latestDate = dates[0];
  if (!latestDate) return todos;

  // 最新日付のデータでKPI達成＋CV多いCRを探す
  const latestData = reportData.filter(r => r.date === latestDate && r.action !== 'PAUSE' && r.action !== 'SKIP');

  for (const row of latestData) {
    const appeal = row.appeal as keyof typeof KPI;
    const kpi = KPI[appeal];
    if (!kpi) continue;

    // KPI達成チェック
    const cpaOk = row.sevenDayCPA > 0 && row.sevenDayCPA <= kpi.allowableCPA;
    const cvOk = row.sevenDayCV >= 5;
    if (!cpaOk || !cvOk) continue;

    // そのCRが全アカウントに展開されているか確認
    const crMatch = row.adName.match(/(CR\d+)/);
    if (!crMatch) continue;
    const crNum = crMatch[1];

    // 同じCR番号のものがどのアカウントにあるか
    const deployedAccounts = new Set(
      latestData.filter(r => r.adName.includes(crNum) && r.appeal === appeal).map(r => r.account),
    );
    const allAccounts = Object.entries(ACCOUNT_APPEAL)
      .filter(([_, a]) => a === appeal)
      .map(([id]) => ACCOUNT_NAMES[id]);
    const missingAccounts = allAccounts.filter(a => !deployedAccounts.has(a));

    if (missingAccounts.length > 0) {
      const ad = ads.find(a => a.name === row.adName);
      const lpCr2 = extractLPCRFromAdName(row.adName);
      const sheetIndRes2 = lpCr2 && indResMap ? (indResMap.get(lpCr2) || 0) : 0;
      const effectiveIndRes2 = Math.max(row.sevenDayIndRes, sheetIndRes2);
      todos.push({
        category: '② 横展開',
        priority: effectiveIndRes2 > 0 ? 'HIGH' : 'MEDIUM',
        action: `${crNum}を${missingAccounts.join(', ')}に横展開`,
        detail: `現在${row.account}で配信中: 7日CV=${row.sevenDayCV}, CPA=¥${row.sevenDayCPA.toFixed(0)}, 個別予約=${effectiveIndRes2}件`,
        adName: row.adName,
        adId: ad?.tiktokId || '',
        account: row.account,
        metrics: { cv: row.sevenDayCV, cpa: row.sevenDayCPA, missingAccounts },
      });
    }
  }

  return todos.sort((a, b) => (b.metrics?.cv || 0) - (a.metrics?.cv || 0));
}

/** ③ 停止CR分析 */
function analyzeStoppedCRs(reportData: any[]): TodoItem[] {
  const todos: TodoItem[] = [];

  // 直近7日で停止されたCRを探す
  const dates = [...new Set(reportData.map(r => r.date))].sort().reverse();
  const recentDates = dates.slice(0, 7);

  const recentPaused = reportData.filter(r =>
    recentDates.includes(r.date) && (r.action === 'PAUSE' || r.pauseDecision === 'PAUSE'),
  );

  // CR名でユニークに
  const seen = new Set<string>();
  for (const row of recentPaused) {
    const key = `${row.account}:${row.adName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const crMatch = row.adName.match(/CR(\d+)/);
    if (!crMatch) continue;

    todos.push({
      category: '③ 停止CR分析',
      priority: 'LOW',
      action: `CR${crMatch[1]}の停止理由を分析`,
      detail: `${row.reason} | 7日CPA=¥${row.sevenDayCPA.toFixed(0)}, CV=${row.sevenDayCV}, 広告費=¥${row.sevenDaySpend.toFixed(0)}`,
      adName: row.adName,
      account: row.account,
      metrics: { cpa: row.sevenDayCPA, cv: row.sevenDayCV, spend: row.sevenDaySpend, reason: row.reason },
    });
  }

  return todos;
}

/** ⑤ LP別CVR比較 */
function analyzeLPComparison(reportData: any[]): TodoItem[] {
  const todos: TodoItem[] = [];

  // 直近の日付データ
  const dates = [...new Set(reportData.map(r => r.date))].sort().reverse();
  const latestDate = dates[0];
  if (!latestDate) return todos;
  const latestData = reportData.filter(r => r.date === latestDate);

  // CR名（制作者/CR名部分）でグループ化し、LP別の成績を比較
  const crGroups = new Map<string, any[]>();
  for (const row of latestData) {
    if (row.sevenDayCV === 0) continue;
    const parts = row.adName.split('/');
    if (parts.length < 4) continue;
    const crKey = `${row.appeal}:${parts[1]}/${parts[2]}`; // 制作者/CR名
    if (!crGroups.has(crKey)) crGroups.set(crKey, []);
    crGroups.get(crKey)!.push(row);
  }

  for (const [crKey, rows] of crGroups) {
    // LP番号を抽出して異なるLPがあるかチェック
    const lpData = new Map<string, any[]>();
    for (const row of rows) {
      const lpMatch = row.adName.match(/LP(\d+)/);
      if (lpMatch) {
        const lp = `LP${lpMatch[1]}`;
        if (!lpData.has(lp)) lpData.set(lp, []);
        lpData.get(lp)!.push(row);
      }
    }

    if (lpData.size >= 2) {
      const lpSummary = [...lpData.entries()].map(([lp, data]) => {
        const totalCV = data.reduce((s, r) => s + r.sevenDayCV, 0);
        const totalSpend = data.reduce((s, r) => s + r.sevenDaySpend, 0);
        const avgCPA = totalCV > 0 ? totalSpend / totalCV : 0;
        return { lp, totalCV, totalSpend, avgCPA, count: data.length };
      }).sort((a, b) => a.avgCPA - b.avgCPA);

      const best = lpSummary[0];
      const worst = lpSummary[lpSummary.length - 1];

      if (best.avgCPA > 0 && worst.avgCPA > 0 && worst.avgCPA > best.avgCPA * 1.3) {
        todos.push({
          category: '⑤ LP比較',
          priority: 'MEDIUM',
          action: `${crKey.split(':')[1]}: ${best.lp}の方が成績良好`,
          detail: lpSummary.map(lp => `${lp.lp}: CPA=¥${lp.avgCPA.toFixed(0)}, CV=${lp.totalCV} (${lp.count}本)`).join(' | '),
          metrics: { lpSummary },
        });
      }
    }
  }

  return todos;
}

/** ⑤-b 累計オプト20以上のCR → LP検証Todo */
function analyzeLPTestCandidates(reportData: any[]): TodoItem[] {
  const todos: TodoItem[] = [];

  // 最新日付のデータ（配信中CRの判定用）
  const dates = [...new Set(reportData.map(r => r.date))].sort().reverse();
  const latestDate = dates[0];
  if (!latestDate) return todos;
  const latestData = reportData.filter(r => r.date === latestDate && r.action !== 'PAUSE');

  // 全期間のレポートから、CRごとにどのLPで出稿されたかを把握
  // キー: 「導線:制作者/CR名」（LP部分を除いたクリエイティブ識別子）
  const allLPsForCR = new Map<string, Set<string>>();
  for (const row of reportData) {
    const parts = row.adName.split('/');
    if (parts.length < 4) continue;
    const crCreative = `${row.appeal}:${parts[1]}/${parts[2]}`;
    const lpMatch = row.adName.match(/LP(\d+)/);
    if (!lpMatch) continue;

    if (!allLPsForCR.has(crCreative)) allLPsForCR.set(crCreative, new Set());
    allLPsForCR.get(crCreative)!.add(`LP${lpMatch[1]}`);
  }

  // 最新データで配信中かつCV20以上のCRを探す
  const crGroups = new Map<string, any[]>();
  for (const row of latestData) {
    if (row.sevenDayCV < 20) continue;
    const parts = row.adName.split('/');
    if (parts.length < 4) continue;
    const crCreative = `${row.appeal}:${parts[1]}/${parts[2]}`;
    if (!crGroups.has(crCreative)) crGroups.set(crCreative, []);
    crGroups.get(crCreative)!.push(row);
  }

  for (const [crKey, rows] of crGroups) {
    // 全期間通じてこのCRがどのLPで出稿されたかチェック
    const allLPs = allLPsForCR.get(crKey) || new Set();
    // 現在配信中のLP
    const activeLPs = new Set<string>();
    for (const row of rows) {
      const lpMatch = row.adName.match(/LP(\d+)/);
      if (lpMatch) activeLPs.add(`LP${lpMatch[1]}`);
    }

    const totalCV = rows.reduce((s, r) => s + r.sevenDayCV, 0);
    const bestCPA = Math.min(...rows.map(r => r.sevenDayCPA).filter(c => c > 0));
    const crMatch = rows[0].adName.match(/CR(\d+)/);
    const crNum = crMatch ? crMatch[1] : '?';

    if (allLPs.size <= 1) {
      // 過去含め1つのLPしか出稿されていない → LP検証を提案
      const currentLP = [...activeLPs][0] || [...allLPs][0] || 'LP1';
      const suggestLP = currentLP === 'LP1' ? 'LP2' : 'LP1';
      todos.push({
        category: '⑤ LP検証',
        priority: 'MEDIUM',
        action: `CR${crNum}: 累計CV=${totalCV}, CPA=¥${bestCPA.toFixed(0)} → ${suggestLP}でもLP検証`,
        detail: `現在${currentLP}のみで配信中。オプト20以上で成績判断に十分なデータあり。${suggestLP}でも出稿してLP別CVR比較を推奨`,
        adName: rows[0].adName,
        adId: '',
        account: rows[0].account,
        metrics: { totalCV, bestCPA, currentLP, suggestLP },
      });
    }
    // allLPs.size >= 2 の場合は⑤のLP比較で既にカバー
  }

  return todos;
}

/** ⑥ Smart+化提案 */
function analyzeSmartPlusCandidates(reportData: any[]): TodoItem[] {
  const todos: TodoItem[] = [];

  // CR番号ごとに、全レポート期間で最大の7日CVを記録（≒そのCRのピーク実績）
  const crBestPerf = new Map<string, { maxCV: number; appeal: string; lp: string; bestCPA: number }>();
  for (const row of reportData) {
    if (row.sevenDayCV <= 0) continue;
    const crMatch = row.adName.match(/CR(\d+)/);
    if (!crMatch) continue;
    const crNum = crMatch[1];
    const lpMatch = row.adName.match(/LP(\d+)/);
    const lp = lpMatch ? lpMatch[1] : '1';
    const key = `${row.appeal}-${crNum}`;

    const existing = crBestPerf.get(key);
    if (!existing || row.sevenDayCV > existing.maxCV) {
      crBestPerf.set(key, { maxCV: row.sevenDayCV, appeal: row.appeal, lp, bestCPA: row.sevenDayCPA });
    }
  }

  // 7日CV10以上 ＋ CPA≦許容CPA のCRを導線×LP別に集計
  const appealLpGroups = new Map<string, { crNum: string; maxCV: number; bestCPA: number }[]>();
  for (const [key, data] of crBestPerf) {
    if (data.maxCV < 10) continue;
    const appeal = data.appeal as keyof typeof KPI;
    const kpi = KPI[appeal];
    if (!kpi) continue;
    if (data.bestCPA <= 0 || data.bestCPA > kpi.allowableCPA) continue;

    const crNum = key.split('-')[1];
    const groupKey = `${appeal}-LP${data.lp}`;
    if (!appealLpGroups.has(groupKey)) appealLpGroups.set(groupKey, []);
    appealLpGroups.get(groupKey)!.push({ crNum, maxCV: data.maxCV, bestCPA: data.bestCPA });
  }

  for (const [key, crs] of appealLpGroups) {
    if (crs.length < 6) continue;

    // CV多い順にソート
    crs.sort((a, b) => b.maxCV - a.maxCV);
    const totalCV = crs.reduce((s, c) => s + c.maxCV, 0);
    todos.push({
      category: '⑥ Smart+化',
        priority: 'HIGH',
        action: `${key}: 勝ちCR ${crs.length}本 → Smart+化検討`,
        detail: `7日CV10以上＋KPI達成: ${crs.map(c => `CR${c.crNum}(7日CV${c.maxCV})`).join(', ')}`,
        metrics: { crCount: crs.length, totalCV, crs: crs.map(c => c.crNum) },
      });
  }

  return todos;
}

/** ④ 時間帯分析 */
async function analyzeTimeOfDay(): Promise<TodoItem[]> {
  const todos: TodoItem[] = [];

  // 直近7日間の時間帯別メトリクスをTikTok APIから取得
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const endDate = new Date(jst);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 6);

  const formatDate = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

  for (const [advertiserId, appeal] of Object.entries(ACCOUNT_APPEAL)) {
    // 主要アカウントのみ（各導線1つ）
    if (!['7468288053866561553', '7247073333517238273', '7474920444831875080'].includes(advertiserId)) continue;

    try {
      const data = await tiktokGet('/v1.3/report/integrated/get/', {
        advertiser_id: advertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_ADVERTISER',
        dimensions: JSON.stringify(['stat_time_hour']),
        metrics: JSON.stringify(['spend', 'conversion', 'cpa', 'impressions', 'clicks']),
        start_date: formatDate(startDate),
        end_date: formatDate(endDate),
        page_size: '24',
      });

      if (data.code !== 0 || !data.data?.list?.length) continue;

      const hourlyData = data.data.list.map((item: any) => ({
        hour: parseInt(item.dimensions?.stat_time_hour || '0'),
        spend: parseFloat(item.metrics?.spend || '0'),
        cv: parseInt(item.metrics?.conversion || '0'),
        impressions: parseInt(item.metrics?.impressions || '0'),
        clicks: parseInt(item.metrics?.clicks || '0'),
      })).filter((h: any) => h.spend > 0);

      if (hourlyData.length === 0) continue;

      // CPA最適な時間帯TOP3とワーストTOP3
      const withCPA = hourlyData.filter((h: any) => h.cv > 0).map((h: any) => ({ ...h, cpa: h.spend / h.cv }));
      if (withCPA.length < 3) continue;

      withCPA.sort((a: any, b: any) => a.cpa - b.cpa);
      const best3 = withCPA.slice(0, 3);
      const worst3 = withCPA.slice(-3).reverse();

      const accountName = ACCOUNT_NAMES[advertiserId];
      todos.push({
        category: '④ 時間帯',
        priority: 'LOW',
        action: `${accountName}(${appeal}): 最適時間帯を把握`,
        detail: `BEST: ${best3.map((h: any) => `${h.hour}時(CPA¥${h.cpa.toFixed(0)},CV${h.cv})`).join(', ')} | WORST: ${worst3.map((h: any) => `${h.hour}時(CPA¥${h.cpa.toFixed(0)},CV${h.cv})`).join(', ')}`,
        metrics: { best3, worst3 },
      });
    } catch (e) {
      // API失敗は無視
    }
  }

  return todos;
}

/** ⑦ 前日個別予約CPOチェック - 個別予約シートから直接読み取り */
async function analyzeRecentIndividualReservationCPO(
  sheets: any,
  reportData: any[],
  ads: any[],
): Promise<TodoItem[]> {
  const todos: TodoItem[] = [];

  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  // 直近3日分を見る（個別予約は翌日以降に入ることもある）
  const checkDays = 3;
  const startDate = new Date(jstNow);
  startDate.setUTCDate(startDate.getUTCDate() - checkDays);
  const startStr = `${startDate.getUTCFullYear()}/${String(startDate.getUTCMonth() + 1).padStart(2, '0')}/${String(startDate.getUTCDate()).padStart(2, '0')}`;
  const endStr = `${jstNow.getUTCFullYear()}/${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}/${String(jstNow.getUTCDate()).padStart(2, '0')}`;

  console.log(`  ⑦ 個別予約シートから直近${checkDays}日分（${startStr}〜${endStr}）を取得中...`);

  // JST日付範囲
  const rangeStart = new Date(`${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}-${String(startDate.getUTCDate()).padStart(2, '0')}T00:00:00+09:00`);
  const rangeEnd = new Date(`${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(jstNow.getUTCDate()).padStart(2, '0')}T23:59:59+09:00`);

  // 導線ごとに個別予約データを取得
  const allReservations = new Map<string, { count: number; appeal: string; paths: string[] }>();

  for (const [appeal, config] of Object.entries(RESERVATION_SHEET_CONFIG)) {
    try {
      const rows = await readSheet(sheets, INDIVIDUAL_RESERVATION_SHEET_ID, `${config.sheetName}!A:AZ`);
      if (rows.length < 2) continue;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const dateValue = row[config.dateCol];
        const pathValue = row[config.pathCol];

        if (!dateValue || !pathValue) continue;

        // 日付パース（JSTとして扱う）
        const dateStr = String(dateValue).trim();
        const slashMatch = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
        if (!slashMatch) continue;

        const rowDate = new Date(Date.UTC(
          parseInt(slashMatch[1]),
          parseInt(slashMatch[2]) - 1,
          parseInt(slashMatch[3]),
          -9, 0, 0, // JST→UTC
        ));
        if (rowDate < rangeStart || rowDate > rangeEnd) continue;

        // 登録経路からLP-CRを抽出
        const lines = String(pathValue).split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const lpCrMatch = trimmed.match(/(LP\d+-CR\d+)/i);
          if (!lpCrMatch) continue;
          const lpCr = lpCrMatch[1].toUpperCase();

          const existing = allReservations.get(lpCr) || { count: 0, appeal, paths: [] };
          existing.count++;
          if (!existing.paths.includes(trimmed)) existing.paths.push(trimmed);
          allReservations.set(lpCr, existing);
        }
      }
    } catch (e) {
      console.error(`    ${appeal}シート読み取りエラー:`, e);
    }
  }

  if (allReservations.size === 0) {
    console.log(`    直近${checkDays}日の個別予約: 0件`);
    return todos;
  }

  console.log(`    直近${checkDays}日の個別予約: ${[...allReservations.values()].reduce((s, v) => s + v.count, 0)}件（${allReservations.size}種類のLP-CR）`);

  // 日次レポートから最新日の各CRの消化額を取得
  const dates = [...new Set(reportData.map(r => r.date))].sort().reverse();
  const latestDate = dates[0];
  const latestReport = latestDate ? reportData.filter(r => r.date === latestDate) : [];

  // LP-CRごとに消化額をマッチ
  for (const [lpCr, resData] of allReservations) {
    const appeal = resData.appeal as keyof typeof KPI;
    const kpi = KPI[appeal];
    if (!kpi) continue;

    // 日次レポートから該当CRの消化額を探す
    const matchingRows = latestReport.filter(r => {
      const adLpCr = extractLPCRFromAdName(r.adName);
      return adLpCr === lpCr && r.appeal === appeal;
    });

    // 同じLP-CRの全広告の消化額を合算（直近7日の消化を使用）
    let totalSpend = 0;
    let totalCV = 0;
    const adNames: string[] = [];
    const accounts: string[] = [];
    for (const row of matchingRows) {
      totalSpend += row.sevenDaySpend;
      totalCV += row.sevenDayCV;
      if (!adNames.includes(row.adName)) adNames.push(row.adName);
      if (!accounts.includes(row.account)) accounts.push(row.account);
    }

    // 消化がない場合はDBから広告IDで検索してTikTok APIも確認
    if (totalSpend === 0) {
      // レポートに載っていないCR（新規出稿でまだレポートに反映されていないケース）
      // DBから検索
      const matchingAds = ads.filter(a => {
        const adLpCr = extractLPCRFromAdName(a.name || '');
        const adAppeal = a.adGroup?.campaign?.advertiser?.tiktokAdvertiserId
          ? ACCOUNT_APPEAL[a.adGroup.campaign.advertiser.tiktokAdvertiserId]
          : null;
        return adLpCr === lpCr && adAppeal === appeal;
      });

      if (matchingAds.length > 0) {
        for (const ad of matchingAds) {
          if (!adNames.includes(ad.name || '')) adNames.push(ad.name || '');
          const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId || '';
          const accName = ACCOUNT_NAMES[advId] || advId;
          if (!accounts.includes(accName)) accounts.push(accName);
        }
      }
    }

    const indResCPO = resData.count > 0 && totalSpend > 0 ? totalSpend / resData.count : 0;
    const kpiOk = indResCPO > 0 && indResCPO <= (kpi.allowableIndResCPO || Infinity);

    const crMatch = lpCr.match(/CR(\d+)/);
    const crNum = crMatch ? crMatch[1] : lpCr;
    const accountStr = accounts.length > 0 ? accounts.join(',') : '不明';

    // 広告名からCR名（制作者/クリエイティブ名）を抽出して表示用に
    const displayAdName = adNames[0] || '不明';
    const adParts = displayAdName.split('/');
    const crDisplayName = adParts.length >= 3 ? `${adParts[1]}/${adParts[2]}` : displayAdName;

    // このCRがどのアカウントに展開済みかチェック
    const deployedAccounts = new Set<string>();
    for (const ad of ads) {
      const adLpCr = extractLPCRFromAdName(ad.name || '');
      const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId || '';
      const adAppeal = ACCOUNT_APPEAL[advId];
      if (adLpCr === lpCr && adAppeal === appeal) {
        deployedAccounts.add(ACCOUNT_NAMES[advId] || advId);
      }
    }
    const allAppealAccounts = Object.entries(ACCOUNT_APPEAL)
      .filter(([_, a]) => a === appeal)
      .map(([id]) => ACCOUNT_NAMES[id]);
    const missingAccounts = allAppealAccounts.filter(a => !deployedAccounts.has(a));
    const deployInfo = deployedAccounts.size > 0
      ? `展開済: ${[...deployedAccounts].join(',')}${missingAccounts.length > 0 ? ` | 未展開: ${missingAccounts.join(',')}` : ' | 全アカウント展開済'}`
      : '';

    if (kpiOk) {
      // KPI以内 → 再出稿候補として推奨
      todos.push({
        category: '⑦ 個別予約CPO',
        priority: 'HIGH',
        action: `${lpCr}「${crDisplayName}」(${appeal}): 個別予約${resData.count}件, CPO ¥${indResCPO.toFixed(0)} → KPI以内！再出稿/予算増を検討`,
        detail: `${accountStr} | 7日消化=¥${totalSpend.toFixed(0)}, 7日CV=${totalCV} | KPI上限: ¥${kpi.allowableIndResCPO?.toLocaleString() || '-'}${deployInfo ? ` | ${deployInfo}` : ''}`,
        adName: displayAdName,
        account: accountStr,
        metrics: { lpCr, reservations: resData.count, spend: totalSpend, indResCPO, cv: totalCV, kpiOk: true, missingAccounts, deployedAccounts: [...deployedAccounts] },
      });
    } else if (indResCPO > 0) {
      // KPI超過 → 様子見 or 停止検討
      todos.push({
        category: '⑦ 個別予約CPO',
        priority: 'MEDIUM',
        action: `${lpCr}「${crDisplayName}」(${appeal}): 個別予約${resData.count}件, CPO ¥${indResCPO.toFixed(0)} → KPI超過（様子見 or 停止検討）`,
        detail: `${accountStr} | 7日消化=¥${totalSpend.toFixed(0)}, 7日CV=${totalCV} | KPI上限: ¥${kpi.allowableIndResCPO?.toLocaleString() || '-'}${deployInfo ? ` | ${deployInfo}` : ''}`,
        adName: displayAdName,
        account: accountStr,
        metrics: { lpCr, reservations: resData.count, spend: totalSpend, indResCPO, cv: totalCV, kpiOk: false, missingAccounts, deployedAccounts: [...deployedAccounts] },
      });
    } else if (totalSpend === 0) {
      // 消化データなし（新規出稿 or レポート未反映）
      todos.push({
        category: '⑦ 個別予約CPO',
        priority: 'LOW',
        action: `${lpCr}「${crDisplayName}」(${appeal}): 個別予約${resData.count}件 → 消化データ未取得（新規出稿 or レポート反映待ち）`,
        detail: `${accountStr} | 広告名: ${displayAdName}${deployInfo ? ` | ${deployInfo}` : ''}`,
        adName: displayAdName,
        account: accountStr,
        metrics: { lpCr, reservations: resData.count, spend: 0, indResCPO: 0, cv: 0, missingAccounts, deployedAccounts: [...deployedAccounts] },
      });
    }
  }

  return todos.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'HIGH' ? -1 : b.priority === 'HIGH' ? 1 : 0;
    return (b.metrics?.reservations || 0) - (a.metrics?.reservations || 0);
  });
}

/** 広告名からLP-CRを抽出 */
function extractLPCRFromAdName(adName: string): string | null {
  if (!adName) return null;
  const parts = adName.split('/');
  if (parts.length < 4) return null;
  const lastPart = parts[parts.length - 1];
  const match = lastPart.match(/(LP\d+-CR\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

/** ルール適用: 各Todoにルールベースの補足を追加 */
function applyRules(todos: TodoItem[], rules: OpsRule[]): TodoItem[] {
  for (const todo of todos) {
    for (const rule of rules) {
      // カテゴリマッチ
      if (rule.category && !todo.category.includes(rule.category)) continue;

      // 条件チェック（簡易: metricsのキーと値で判定）
      if (rule.condition) {
        try {
          const [key, op, val] = rule.condition.split(/\s+/);
          const metricVal = todo.metrics?.[key];
          if (metricVal === undefined) continue;

          const numVal = parseFloat(val);
          if (op === '>' && !(metricVal > numVal)) continue;
          if (op === '<' && !(metricVal < numVal)) continue;
          if (op === '>=' && !(metricVal >= numVal)) continue;
          if (op === '<=' && !(metricVal <= numVal)) continue;
          if (op === '==' && metricVal != numVal) continue;
        } catch { continue; }
      }

      // ルール適用: detailに補足追加
      if (rule.action) {
        todo.detail += ` | 💡ルール[${rule.id}]: ${rule.action}`;
      }
    }
  }
  return todos;
}

// ===== ⑨ ファネルボトルネック分析（profit-simulationドメインロジック使用） =====
// 要件定義書 docs/PROFIT_SIMULATION_SPEC.md の Step 1〜6 を実行

import { calculateProfitSimulation, calculateTotalProfitSummary } from './src/profit-simulation/domain/profit-simulation';
import { judgeDirection, calculateRequiredAcquisition } from './src/profit-simulation/domain/direction-judgment';
import { detectBottlenecks } from './src/profit-simulation/domain/bottleneck-detection';
import type { ChannelType, ProfitSimulation, MonthlyMetricsData, KPITargets } from './src/profit-simulation/domain/types';
import { parseKpiPercentage, parseKpiAmount } from './src/profit-simulation/infrastructure/kpi-value-parser';

const SIM_SHEET_NAMES: Record<ChannelType, string> = {
  AI: 'AI', SNS: 'SNS', SKILL_PLUS: 'スキルプラス（オートウェビナー用）',
};
const SIM_AI_SNS_COLS = {
  impressions: 2, clicks: 5, optins: 11, listIns: 13, cpc: 17, optCPA: 18,
  frontPurchase: 21, secretRoom: 24, 成約数: 27, revenue: 34, optinLTV: 36,
  individualRes: 38, adSpend: 44,
} as const;
const SIM_SP_COLS = {
  impressions: 2, clicks: 5, optins: 7, listIns: 9, cpc: 12, optCPA: 13,
  seminarRes: 14, seminarAttend: 17, individualRes: 23, closings: 25,
  revenue: 26, optinLTV: 28, adSpend: 32,
} as const;
const SIM_KPI_COLS: Record<ChannelType, { itemCol: number; allowCol: number; targetCol: number }> = {
  AI: { itemCol: 47, allowCol: 48, targetCol: 49 },
  SNS: { itemCol: 47, allowCol: 48, targetCol: 49 },
  SKILL_PLUS: { itemCol: 36, allowCol: 37, targetCol: 38 },
};
const SIM_KPI_PERCENTAGE_ITEMS = [
  'ROAS', 'オプト→フロント率', 'フロント→個別率', '個別→着座率', '着座→成約率',
  'オプト→メイン', 'メイン→企画', '企画→セミナー予約率',
  'セミナー予約→セミナー着座率', 'セミナー着座→個別予約率',
  '個別予約→個別着座率', '個別着座→成約率',
];

function simParseNum(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  const s = String(val).replace(/[¥,%、,]/g, '').trim();
  return parseFloat(s) || 0;
}

async function simFindMonthBlock(sheets: any, sheetName: string, month: number) {
  const rows = await readSheet(sheets, INDIVIDUAL_RESERVATION_SHEET_ID, `'${sheetName}'!A:A`);
  const monthStr = `${month}月`;
  let summaryRow = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]?.[0] || '').trim() === monthStr) { summaryRow = i + 1; break; }
  }
  if (summaryRow === -1) throw new Error(`${monthStr}が見つかりません`);
  let dailyEndRow = summaryRow;
  for (let i = summaryRow; i < rows.length; i++) {
    const v = String(rows[i]?.[0] || '').trim();
    if (i > summaryRow && (v === '' || v.match(/^\d+月$/) || v === '返金')) break;
    if (v.match(/^\d{4}\/\d{1,2}\/\d{1,2}$/)) dailyEndRow = i + 1;
  }
  return { summaryRow, dailyStartRow: summaryRow + 1, dailyEndRow };
}

async function simGetMetrics(sheets: any, channelType: ChannelType, year: number, month: number): Promise<MonthlyMetricsData> {
  const sheetName = SIM_SHEET_NAMES[channelType];
  const cols = channelType === 'SKILL_PLUS' ? SIM_SP_COLS : SIM_AI_SNS_COLS;
  const { summaryRow, dailyStartRow, dailyEndRow } = await simFindMonthBlock(sheets, sheetName, month);
  const summaryData = await readSheet(sheets, INDIVIDUAL_RESERVATION_SHEET_ID, `'${sheetName}'!A${summaryRow}:AX${summaryRow}`);
  const s = summaryData[0] || [];
  const dailyRows = await readSheet(sheets, INDIVIDUAL_RESERVATION_SHEET_ID, `'${sheetName}'!A${dailyStartRow}:AX${dailyEndRow}`);
  const dailyData = dailyRows.filter(r => /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(String(r[0] || '').trim())).map(r => ({
    date: String(r[0]).trim(), impressions: simParseNum(r[cols.impressions]), clicks: simParseNum(r[cols.clicks]),
    optins: simParseNum(r[cols.optins]), adSpend: simParseNum(r[cols.adSpend]), revenue: simParseNum(r[(cols as any).revenue]),
    cpc: simParseNum(r[cols.cpc]), stageValues: {} as Record<string, number>,
  }));

  const stageMetrics: Record<string, number> = {};
  stageMetrics['インプレッション'] = simParseNum(s[cols.impressions]);
  stageMetrics['クリック'] = simParseNum(s[cols.clicks]);
  stageMetrics['オプトイン'] = simParseNum(s[cols.optins]);
  stageMetrics['LINE登録'] = simParseNum(s[cols.listIns]);
  if (channelType === 'SKILL_PLUS') {
    const sp = cols as typeof SIM_SP_COLS;
    stageMetrics['セミナー予約'] = simParseNum(s[sp.seminarRes]);
    stageMetrics['セミナー着座'] = simParseNum(s[sp.seminarAttend]);
    stageMetrics['個別予約'] = simParseNum(s[sp.individualRes]);
    stageMetrics['バックエンド購入'] = simParseNum(s[sp.closings]);
  } else {
    const ai = cols as typeof SIM_AI_SNS_COLS;
    stageMetrics['フロント購入'] = simParseNum(s[ai.frontPurchase]);
    stageMetrics['秘密の部屋購入'] = simParseNum(s[ai.secretRoom]);
    stageMetrics['個別予約'] = simParseNum(s[ai.individualRes]);
    stageMetrics['バックエンド購入'] = simParseNum(s[ai['成約数']]);
  }

  return {
    channelType, year, month, adSpend: simParseNum(s[cols.adSpend]), totalRevenue: simParseNum(s[(cols as any).revenue]),
    optinCount: simParseNum(s[cols.optins]), clickCount: simParseNum(s[cols.clicks]),
    impressions: simParseNum(s[cols.impressions]), optinLTV: simParseNum(s[(cols as any).optinLTV]),
    stageMetrics, dailyData,
  };
}

async function simGetKPI(sheets: any, channelType: ChannelType): Promise<KPITargets> {
  const sheetName = SIM_SHEET_NAMES[channelType];
  const kpiCols = SIM_KPI_COLS[channelType];
  const rows = await readSheet(sheets, INDIVIDUAL_RESERVATION_SHEET_ID, `'${sheetName}'!A:AZ`);
  const conversionRates: Record<string, number> = {};
  let targetROAS = 0, avgPaymentAmount = 0, cpa = 0;
  for (const row of rows) {
    const item = String(row[kpiCols.itemCol] || '').trim();
    const allow = String(row[kpiCols.allowCol] || '').trim();
    if (!item || !allow) continue;
    if (SIM_KPI_PERCENTAGE_ITEMS.includes(item)) {
      const v = parseKpiPercentage(allow);
      if (!isNaN(v)) { conversionRates[item] = v; if (item === 'ROAS') targetROAS = v; }
    } else if (item === '商品単価') { avgPaymentAmount = parseKpiAmount(allow) || 0; }
    else if (item === 'CPA') { cpa = parseKpiAmount(allow) || 0; }
  }
  return { conversionRates, targetROAS, avgPaymentAmount, cpa };
}

async function simGetTargetProfit(sheets: any, channelType: ChannelType): Promise<number> {
  const sheetName = SIM_SHEET_NAMES[channelType];
  const kpiCols = SIM_KPI_COLS[channelType];
  const rows = await readSheet(sheets, INDIVIDUAL_RESERVATION_SHEET_ID, `'${sheetName}'!A:AZ`);
  for (const row of rows) {
    const item = String(row[kpiCols.itemCol] || '').trim();
    if (item === '目標粗利額') {
      const val = String(row[kpiCols.targetCol] || row[kpiCols.allowCol] || '').trim();
      if (val) return parseKpiAmount(val) || 0;
    }
  }
  return 0;
}

const CHANNEL_LABELS: Record<ChannelType, string> = { AI: 'AI', SNS: 'SNS', SKILL_PLUS: 'スキルプラス' };

async function analyzeFunnelBottlenecks(sheets: any) {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const year = jstNow.getUTCFullYear();
  const month = jstNow.getUTCMonth() + 1;
  const dayOfMonth = jstNow.getUTCDate();
  const totalDaysInMonth = new Date(year, month, 0).getDate();

  console.log(`\n── ⑨ 利益シミュレーション & ボトルネック特定（${month}月 ${dayOfMonth}/${totalDaysInMonth}日経過） ──`);

  const ALL_CHANNELS: ChannelType[] = ['AI', 'SNS', 'SKILL_PLUS'];
  const channelResults: ProfitSimulation[] = [];

  for (const channelType of ALL_CHANNELS) {
    const label = CHANNEL_LABELS[channelType];
    try {
      const metrics = await simGetMetrics(sheets, channelType, year, month);
      const kpi = await simGetKPI(sheets, channelType);
      const targetProfit = await simGetTargetProfit(sheets, channelType);

      // Step 2: シミュレーション
      const actualDays = metrics.dailyData.filter(d => d.adSpend > 0 || d.optins > 0).length || dayOfMonth;
      const simulation = calculateProfitSimulation({
        channelType, year, month, actualDays, totalDaysInMonth,
        actualAdSpend: metrics.adSpend, actualRevenue: metrics.totalRevenue, targetProfit,
      });
      channelResults.push(simulation);

      // Step 3-4: 方向判定
      const cpa = metrics.optinCount > 0 ? metrics.adSpend / metrics.optinCount : 0;
      const requiredAcquisition = calculateRequiredAcquisition(targetProfit, metrics.optinLTV, cpa);
      const targetROAS = metrics.adSpend > 0
        ? (targetProfit + simulation.projectedAdSpend) / simulation.projectedAdSpend
        : kpi.targetROAS;
      const currentROAS = metrics.adSpend > 0 ? metrics.totalRevenue / metrics.adSpend : 0;
      const judgment = judgeDirection({ currentROAS, targetROAS, currentAcquisition: metrics.optinCount, requiredAcquisition });

      // Step 5-6: ボトルネック特定
      const bottlenecks = detectBottlenecks(channelType, metrics.stageMetrics, kpi);

      // 表示
      const profitIcon = simulation.isOnTrack ? '✅' : '❌';
      console.log(`\n  [${label}] 粗利: ¥${simulation.actualProfit.toLocaleString()} → 月末推定 ¥${simulation.projectedProfit.toLocaleString()} / 目標 ¥${targetProfit.toLocaleString()} ${profitIcon}`);

      // ステージ実績をファネル形式で表示
      const sm = metrics.stageMetrics;
      if (channelType === 'SKILL_PLUS') {
        console.log(`    imp ${sm['インプレッション']?.toLocaleString()} → click ${sm['クリック']?.toLocaleString()} → オプト ${sm['オプトイン']} → リスト ${sm['LINE登録']} → セミナー予約 ${sm['セミナー予約']} → 着座 ${sm['セミナー着座']} → 個別予約 ${sm['個別予約']} → 成約 ${sm['バックエンド購入']}`);
      } else {
        console.log(`    imp ${sm['インプレッション']?.toLocaleString()} → click ${sm['クリック']?.toLocaleString()} → オプト ${sm['オプトイン']} → フロント ${sm['フロント購入']} → 個別予約 ${sm['個別予約']} → 成約 ${sm['バックエンド購入']}`);
      }

      // 方向判定
      const dirLabels: Record<string, string> = {
        ON_TRACK: '✅ 目標到達見込み',
        IMPROVE_ROAS: '📈 ROAS改善が必要',
        INCREASE_ACQUISITION: '📊 集客数を増やす必要あり',
        BOTH: '⚠️ ROAS改善 + 集客数増の両方が必要',
      };
      console.log(`    判定: ${dirLabels[judgment.direction]} (ROAS ${(currentROAS * 100).toFixed(0)}%→目標${(targetROAS * 100).toFixed(0)}%, 集客 ${metrics.optinCount}→必要${isFinite(requiredAcquisition) ? requiredAcquisition : '∞'})`);

      // ボトルネック
      if (bottlenecks.length > 0) {
        console.log(`    ボトルネック（KPI許容値との乖離・粗利インパクト順）:`);
        for (const b of bottlenecks) {
          console.log(`      #${b.rank} ${b.stage}: 現状 ${(b.currentRate * 100).toFixed(1)}% vs 許容 ${(b.targetRate * 100).toFixed(1)}% (${b.gapPoints}pt) → 粗利インパクト ¥${b.profitImpact.toLocaleString()}`);
        }
      } else {
        console.log(`    ✅ 全KPI許容値以内`);
      }
    } catch (e: any) {
      console.log(`  [${label}] エラー: ${e.message}`);
    }
  }

  // 全体サマリー
  if (channelResults.length > 0) {
    const summary = calculateTotalProfitSummary(channelResults, { year, month });
    console.log(`\n  【全体】月末推定粗利 ¥${summary.totalProjectedProfit.toLocaleString()} / 目標 ¥${summary.totalTargetProfit.toLocaleString()} ${summary.isOnTrack ? '✅' : '❌'}`);
  }
}

// ===== ⑩ 停止CR自動効果測定 =====
import { evaluateAd } from './src/ad-evaluation/domain/evaluate-ad';
import type { AdPerformance } from './src/ad-evaluation/domain/types';

const EVAL_KPI_MAP: Record<string, { allowableCPA: number; allowableFrontCPO: number | null; allowableIndResCPO: number }> = {
  'AI': { allowableCPA: 4032, allowableFrontCPO: 39378, allowableIndResCPO: 53795 },
  'SNS': { allowableCPA: 2499, allowableFrontCPO: 31637, allowableIndResCPO: 37753 },
  'スキルプラス': { allowableCPA: 6000, allowableFrontCPO: null, allowableIndResCPO: 48830 },
};

function analyzeAutoEvaluation(reportData: any[], ads: any[], utageMetrics: AccountUTAGEMetrics[]): TodoItem[] {
  const todos: TodoItem[] = [];

  // 直近の日付を取得
  const dates = [...new Set(reportData.map(r => r.date))].sort().reverse();
  const latestDate = dates[0];
  if (!latestDate) return todos;

  // 最新日付でPAUSEされた or 配信中のCRを特定
  const latestData = reportData.filter(r => r.date === latestDate);

  // CR単位でユニーク化（同じCR名が複数アカウントにある場合は最も消化額が大きいものを代表）
  const crMap = new Map<string, any>();
  for (const row of latestData) {
    const crMatch = row.adName.match(/(CR\d+)/);
    if (!crMatch) continue;
    const key = `${row.appeal}:${crMatch[1]}`;
    const existing = crMap.get(key);
    if (!existing || row.sevenDaySpend > existing.sevenDaySpend) {
      crMap.set(key, row);
    }
  }

  // UTAGE metricsからCR別のオプト/フロント/個別予約を取得するためのマップ
  const utageByPath = new Map<string, { cv: number; front: number; indRes: number }>();
  for (const m of utageMetrics) {
    for (const [regPath, data] of m.crPaths) {
      utageByPath.set(regPath, data);
    }
  }

  for (const [key, row] of crMap) {
    const appeal = row.appeal;
    const kpi = EVAL_KPI_MAP[appeal];
    if (!kpi) continue;

    const isPaused = row.action === 'PAUSE' || row.pauseDecision === 'PAUSE';
    const isActive = row.action !== 'PAUSE' && row.action !== 'SKIP' && row.pauseDecision !== 'PAUSE';

    // 効果測定対象: 停止されたCR + 配信中CR
    const ad: AdPerformance = {
      adName: row.adName,
      adId: ads.find(a => a.name === row.adName)?.tiktokId || '',
      channelType: appeal === 'スキルプラス' ? 'SKILL_PLUS' : appeal as 'AI' | 'SNS',
      account: row.account,
      status: isPaused ? 'STOPPED' : 'ENABLE',
      daysActive: 7, // 7日レポートベース
      spend: row.sevenDaySpend,
      optins: row.sevenDayCV,
      frontPurchases: row.sevenDayFrontSales,
      individualReservations: row.sevenDayIndRes,
      closings: 0,
    };

    const result = evaluateAd(ad, kpi);

    // 判定アイコン
    const verdictIcons: Record<string, string> = {
      SUCCESS: '✅', PARTIAL_SUCCESS: '🟡', FAILURE: '❌',
      INSUFFICIENT_DATA: '⚪', MONITORING: '🔵',
    };
    const icon = verdictIcons[result.verdict] || '?';

    // 次アクションの日本語ラベル
    const actionLabels: Record<string, string> = {
      CROSS_DEPLOY: '横展開', REDEPLOY: '再出稿', CHANGE_LP: 'LP変更',
      CHANGE_HOOK: 'フック差し替え', ABANDON: '廃止', INVESTIGATE: '要調査',
      CONTINUE: '経過観察',
    };
    const actionLabel = actionLabels[result.nextAction.type] || result.nextAction.type;

    const crMatch = row.adName.match(/CR(\d+)/);
    const crNum = crMatch ? crMatch[1] : '?';
    const adParts = row.adName.split('/');
    const crDisplayName = adParts.length >= 3 ? `${adParts[1]}/${adParts[2]}` : row.adName;

    // MONITORINGは配信中なので簡潔に
    if (result.verdict === 'MONITORING') {
      // 配信中CRは件数が多いので、CVが出ているものだけ表示
      if (row.sevenDayCV >= 5) {
        todos.push({
          category: '⑩ 効果測定',
          priority: 'LOW',
          action: `${icon} CR${crNum}「${crDisplayName}」(${row.account}): 配信中 7日CV=${row.sevenDayCV}, CPA=¥${row.sevenDayCPA.toFixed(0)}`,
          detail: `${result.interpretation}`,
          adName: row.adName,
          account: row.account,
          metrics: { verdict: result.verdict },
        });
      }
      continue;
    }

    // INSUFFICIENT_DATAは省略
    if (result.verdict === 'INSUFFICIENT_DATA') continue;

    // 停止CRの効果測定結果
    const priority = result.verdict === 'SUCCESS' ? 'HIGH'
      : result.verdict === 'FAILURE' ? 'MEDIUM' : 'MEDIUM';

    todos.push({
      category: '⑩ 効果測定',
      priority,
      action: `${icon} CR${crNum}「${crDisplayName}」(${row.account}): ${result.interpretation}`,
      detail: `次アクション: 【${actionLabel}】${result.nextAction.reason}`,
      adName: row.adName,
      adId: ad.adId,
      account: row.account,
      metrics: {
        verdict: result.verdict,
        nextActionType: result.nextAction.type,
        spend: result.metrics.spend,
        optins: result.metrics.optins,
        cpa: result.metrics.cpa,
        indResCPO: result.metrics.indResCPO,
      },
    });
  }

  // SUCCESS → FAILURE → PARTIAL の順にソート
  const verdictOrder: Record<string, number> = { SUCCESS: 0, FAILURE: 1, PARTIAL_SUCCESS: 2, MONITORING: 3 };
  return todos.sort((a, b) =>
    (verdictOrder[a.metrics?.verdict] || 9) - (verdictOrder[b.metrics?.verdict] || 9));
}

// ===== ⑪ 仮説検証追跡 =====
import { checkProgress, evaluateHypothesis } from './src/ad-evaluation/domain/hypothesis-tracker';
import { PrismaHypothesisRepository } from './src/ad-evaluation/infrastructure/prisma-hypothesis-repository';

async function trackHypotheses(reportData: any[], ads: any[]): Promise<TodoItem[]> {
  const todos: TodoItem[] = [];
  const repo = new PrismaHypothesisRepository(prisma);

  // RUNNING状態の仮説を取得
  const running = await repo.findByStatus('RUNNING');
  if (running.length === 0) return todos;

  console.log(`\n  ⑪ 仮説検証追跡: ${running.length}件のRUNNING仮説`);

  // 最新レポートデータ
  const dates = [...new Set(reportData.map(r => r.date))].sort().reverse();
  const latestDate = dates[0];
  const latestData = latestDate ? reportData.filter(r => r.date === latestDate) : [];

  for (const h of running) {
    if (!h.adId && !h.adName) continue;

    // この仮説に対応する広告のレポートデータを探す
    const matchingRow = latestData.find(r => {
      if (h.adId) {
        const ad = ads.find(a => a.tiktokId === h.adId);
        return ad && ad.name === r.adName;
      }
      return h.adName && r.adName === h.adName;
    });

    // DB上の広告ステータスも確認
    const adRecord = h.adId ? ads.find(a => a.tiktokId === h.adId) : ads.find(a => a.name === h.adName);
    const isStillRunning = adRecord?.status === 'ENABLE';

    const metrics = {
      daysActive: 7,
      spend: matchingRow?.sevenDaySpend || 0,
      optins: matchingRow?.sevenDayCV || 0,
      frontPurchases: matchingRow?.sevenDayFrontSales || 0,
      individualReservations: matchingRow?.sevenDayIndRes || 0,
      isStillRunning,
    };

    const progress = checkProgress(metrics);

    if (progress.shouldEvaluate) {
      // 停止済み → 自動効果測定
      const appeal = h.channelType === 'SKILL_PLUS' ? 'スキルプラス' : h.channelType;
      const kpi = EVAL_KPI_MAP[appeal];
      if (!kpi) continue;

      const adPerf: AdPerformance = {
        adName: h.adName || '',
        adId: h.adId || '',
        channelType: h.channelType,
        account: h.account || '',
        status: 'STOPPED',
        daysActive: metrics.daysActive,
        spend: metrics.spend,
        optins: metrics.optins,
        frontPurchases: metrics.frontPurchases,
        individualReservations: metrics.individualReservations,
        closings: 0,
      };

      const evalResult = evaluateAd(adPerf, kpi);

      // DB更新
      const evaluated = evaluateHypothesis(h as any, {
        verdict: evalResult.verdict,
        interpretation: evalResult.interpretation,
        nextAction: `${evalResult.nextAction.type}: ${evalResult.nextAction.reason}`,
        spend: metrics.spend,
        optins: metrics.optins,
        frontPurchases: metrics.frontPurchases,
        individualReservations: metrics.individualReservations,
        cpa: evalResult.metrics.cpa,
        indResCPO: evalResult.metrics.indResCPO,
      });

      await repo.update(h.id, evaluated);

      const verdictIcon = evalResult.verdict === 'SUCCESS' ? '✅' : evalResult.verdict === 'FAILURE' ? '❌' : '🟡';
      const crMatch = (h.adName || '').match(/CR(\d+)/);
      const crNum = crMatch ? crMatch[1] : '?';

      todos.push({
        category: '⑪ 仮説検証',
        priority: evalResult.verdict === 'SUCCESS' ? 'HIGH' : 'MEDIUM',
        action: `${verdictIcon} CR${crNum}(${h.account}) 仮説検証完了: ${evalResult.interpretation}`,
        detail: `仮説: ${h.hypothesis}\n      結果: 【${evalResult.nextAction.type}】${evalResult.nextAction.reason}`,
        adName: h.adName,
        adId: h.adId,
        account: h.account,
        metrics: { verdict: evalResult.verdict, hypothesisId: h.id },
      });

    } else {
      // 配信中 → 経過報告
      const crMatch = (h.adName || '').match(/CR(\d+)/);
      const crNum = crMatch ? crMatch[1] : '?';

      let action = `🔵 CR${crNum}(${h.account}) ${progress.summary}`;
      if (progress.earlyWarning) {
        action = `⚠️ CR${crNum}(${h.account}) ${progress.summary} — ${progress.earlyWarning}`;
      }

      todos.push({
        category: '⑪ 仮説検証',
        priority: progress.earlyWarning ? 'MEDIUM' : 'LOW',
        action,
        detail: `仮説: ${h.hypothesis}`,
        adName: h.adName,
        adId: h.adId,
        account: h.account,
        metrics: { verdict: 'MONITORING', hypothesisId: h.id },
      });
    }
  }

  return todos;
}

// ===== メイン =====
async function main() {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dateStr = `${jstNow.getUTCFullYear()}/${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}/${String(jstNow.getUTCDate()).padStart(2, '0')}`;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  日次運用OS - ${dateStr} のTodo`);
  console.log(`${'='.repeat(60)}\n`);

  // ルール読み込み
  const rules = loadRules();
  if (rules.length > 0) {
    console.log(`  適用ルール: ${rules.length}件（daily-ops-rules.mdより）`);
  }

  const sheets = await getSheetsClient();

  // データ取得
  console.log('データ取得中...');
  const [reportData, ads] = await Promise.all([
    getDailyReportData(sheets),
    getAdsFromDB(),
  ]);
  console.log(`  日次レポート: ${reportData.length}行, DB広告数: ${ads.length}\n`);

  // 各分析を実行
  const allTodos: TodoItem[] = [];

  // 個別予約シートから直近7日分を事前取得（①②⑦で共有）
  const indResMap = await getRecentIndividualReservations(sheets, 7);

  // ① 再出稿候補
  const redeployTodos = analyzeRedeployCandidates(reportData, ads, indResMap);
  allTodos.push(...redeployTodos);

  // ② 横展開候補
  const crossDeployTodos = analyzeCrossDeployCandidates(reportData, ads, indResMap);
  allTodos.push(...crossDeployTodos);

  // ③ 停止CR分析
  const stoppedTodos = analyzeStoppedCRs(reportData);
  allTodos.push(...stoppedTodos);

  // ④ 時間帯分析
  const timeTodos = await analyzeTimeOfDay();
  allTodos.push(...timeTodos);

  // ⑤ LP別CVR比較
  const lpTodos = analyzeLPComparison(reportData);
  allTodos.push(...lpTodos);

  // ⑤-b LP検証候補（累計オプト20以上）
  const lpTestTodos = analyzeLPTestCandidates(reportData);
  allTodos.push(...lpTestTodos);

  // ⑥ Smart+化提案
  const smartPlusTodos = analyzeSmartPlusCandidates(reportData);
  allTodos.push(...smartPlusTodos);

  // ⑦ 前日個別予約CPOチェック（個別予約シートから直接取得）
  const indResTodos = await analyzeRecentIndividualReservationCPO(sheets, reportData, ads);
  allTodos.push(...indResTodos);

  // ⑧ アカウント別スプシ集計（UTAGE経由のCV/フロント/個別予約）
  console.log('\n  ⑧ スプシからアカウント別CV/フロント/個別予約を集計中...');
  const utageMetrics = await getAccountUTAGEMetrics(sheets, ads);

  // ⑩ 停止CR自動効果測定
  const evalTodos = analyzeAutoEvaluation(reportData, ads, utageMetrics);
  allTodos.push(...evalTodos);

  // ⑪ 仮説検証追跡（RUNNING状態の仮説をチェック→停止されていたら自動効果測定）
  const hypothesisTodos = await trackHypotheses(reportData, ads);
  allTodos.push(...hypothesisTodos);

  // ルール適用
  if (rules.length > 0) {
    applyRules(allTodos, rules);
  }

  // ⑧ アカウント別スプシ集計を最初に表示
  // 導線単位の個別予約合計を⑦のデータから集計（個別予約シートはアカウント区別不可のため導線単位）
  const indResByAppeal = new Map<string, number>();
  for (const todo of indResTodos) {
    if (todo.metrics?.reservations) {
      // ⑦のTodoからappealを抽出（actionに含まれる）
      for (const appeal of ['AI', 'SNS', 'スキルプラス']) {
        if (todo.action.includes(`(${appeal})`)) {
          indResByAppeal.set(appeal, (indResByAppeal.get(appeal) || 0) + (todo.metrics.reservations as number));
        }
      }
    }
  }

  // ⑨ ファネルボトルネック分析（スプシ月次集計行から）
  console.log('\n  ⑨ ファネルボトルネック分析中...');
  await analyzeFunnelBottlenecks(sheets);

  if (utageMetrics.length > 0) {
    console.log(`\n── ⑧ アカウント別 7日実績（スプシ/UTAGE） ──`);
    // 導線でグループ化
    const byAppeal = new Map<string, AccountUTAGEMetrics[]>();
    for (const m of utageMetrics) {
      if (!byAppeal.has(m.appeal)) byAppeal.set(m.appeal, []);
      byAppeal.get(m.appeal)!.push(m);
    }
    for (const [appeal, accounts] of byAppeal) {
      const kpi = KPI[appeal as keyof typeof KPI];
      const appealIndRes = indResByAppeal.get(appeal) || 0;
      const totalOpt = accounts.reduce((s, m) => s + m.cvCount, 0);
      const totalFront = accounts.reduce((s, m) => s + m.frontSales, 0);
      console.log(`  [${appeal}導線] KPI: CPA≦¥${kpi?.allowableCPA || '-'}, 個別予約CPO≦¥${kpi?.allowableIndResCPO || '-'} | 導線合計: オプト=${totalOpt}, フロント=${totalFront}, 個別予約=${appealIndRes}件(直近3日)`);
      for (const m of accounts) {
        const warn = m.cvCount === 0 && m.adCount > 0 ? ' ⚠️CV0!' : '';
        console.log(`    ${m.account}: オプト=${m.cvCount}, フロント=${m.frontSales}, 配信中=${m.adCount}本${warn}`);
      }
    }
  }

  // カテゴリ別に表示
  const categories = ['⑪ 仮説検証', '⑩ 効果測定', '⑦ 個別予約CPO', '① 再出稿', '② 横展開', '⑥ Smart+化', '⑤ LP比較', '⑤ LP検証', '③ 停止CR分析', '④ 時間帯'];
  let todoNumber = 1;

  for (const cat of categories) {
    const items = allTodos.filter(t => t.category === cat);
    if (items.length === 0) continue;

    const priorityEmoji = { HIGH: '🔴', MEDIUM: '🟡', LOW: '⚪' };
    console.log(`\n── ${cat} (${ items.length}件) ──`);
    for (const item of items) {
      const prefix = (cat === '⑩ 効果測定' || cat === '⑪ 仮説検証') ? '' : `${priorityEmoji[item.priority]} `;
      console.log(`  [${todoNumber}] ${prefix}${item.action}`);
      console.log(`      ${item.detail}`);
      if (item.adId) console.log(`      ad_id: ${item.adId}`);
      todoNumber++;
    }
  }

  if (allTodos.length === 0) {
    console.log('本日のTodoはありません。全CRが正常に稼働中です。');
  } else {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`合計: ${allTodos.length}件 (HIGH: ${allTodos.filter(t => t.priority === 'HIGH').length}, MEDIUM: ${allTodos.filter(t => t.priority === 'MEDIUM').length}, LOW: ${allTodos.filter(t => t.priority === 'LOW').length})`);
    console.log(`\n実行したい番号を指定してください（例: "1, 3を実行して"）`);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
