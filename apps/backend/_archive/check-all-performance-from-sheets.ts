/**
 * 全導線のスプレッドシート実績を確認するスタンドアロンスクリプト
 * Prisma + Google Sheets API直接使用
 */
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

const INDIVIDUAL_RESERVATION_SPREADSHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

// Google Sheets認証
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

function extractSpreadsheetId(url: string): string {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Invalid spreadsheet URL: ${url}`);
  return match[1];
}

function parseDate(dateString: string): Date | null {
  if (!dateString) return null;
  const trimmed = dateString.trim();
  // YYYY/MM/DD HH:MM:SS or YYYY-MM-DD
  const match = trimmed.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!match) return null;
  return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
}

async function getSheetData(spreadsheetId: string, sheetName: string, range = 'A:Z'): Promise<any[][]> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!${range}`,
    });
    return res.data.values || [];
  } catch (e: any) {
    console.log(`    ⚠ シート「${sheetName}」取得エラー: ${e.message?.substring(0, 60)}`);
    return [];
  }
}

async function countRegistrationPath(
  spreadsheetId: string,
  sheetName: string,
  registrationPathPrefix: string,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  const rows = await getSheetData(spreadsheetId, sheetName);
  if (rows.length === 0) return 0;

  // ヘッダーから列位置検出
  const header = rows[0];
  let pathCol = -1;
  let dateCol = -1;
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] || '').trim();
    if (['登録経路', '流入経路', 'ファネル登録経路'].includes(h)) pathCol = i;
    if (['登録日時', '登録日', 'アクション実行日時', '実行日時'].includes(h)) dateCol = i;
  }
  if (pathCol === -1 || dateCol === -1) return 0;

  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const pathValue = String(row[pathCol] || '');
    const dateValue = String(row[dateCol] || '');
    if (!pathValue.startsWith(registrationPathPrefix)) continue;
    const rowDate = parseDate(dateValue);
    if (!rowDate || rowDate < startDate || rowDate > endDate) continue;
    count++;
  }
  return count;
}

async function countIndividualReservation(
  channelType: string,
  registrationPathPrefix: string,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  const config: Record<string, { sheetName: string; dateCol: number; pathCol: number }> = {
    SEMINAR: { sheetName: 'スキルプラス（オートウェビナー用）', dateCol: 0, pathCol: 34 },
    AI: { sheetName: 'AI', dateCol: 0, pathCol: 46 },
    SNS: { sheetName: 'SNS', dateCol: 0, pathCol: 46 },
  };
  const c = config[channelType];
  if (!c) return 0;

  const rows = await getSheetData(INDIVIDUAL_RESERVATION_SPREADSHEET_ID, c.sheetName, 'A:AZ');
  if (rows.length === 0) return 0;

  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateValue = String(row[c.dateCol] || '');
    const pathValue = String(row[c.pathCol] || '');
    if (!dateValue) continue;
    const rowDate = parseDate(dateValue);
    if (!rowDate || rowDate < startDate || rowDate > endDate) continue;
    // セル内に改行区切りで複数パスの場合あり
    const lines = pathValue.split('\n');
    for (const line of lines) {
      if (line.trim().startsWith(registrationPathPrefix)) count++;
    }
  }
  return count;
}

async function main() {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = new Date(jstNow.getFullYear(), jstNow.getMonth(), jstNow.getDate());
  const days7ago = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const days30ago = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  console.log(`=== 全導線スプレッドシート実績レポート ===`);
  console.log(`期間: 7日(${days7ago.toISOString().slice(0,10)} ~ ${today.toISOString().slice(0,10)}), 30日(${days30ago.toISOString().slice(0,10)} ~)\n`);

  const appeals = await prisma.appeal.findMany({
    include: {
      advertisers: true,
    },
  });

  const results: any[] = [];

  for (const appeal of appeals) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 ${appeal.name} (${appeal.channelType})`);
    console.log(`   目標CPA: ¥${appeal.targetCPA || 'N/A'} | 許容CPA: ¥${appeal.allowableCPA || 'N/A'} | 許容フロントCPO: ¥${appeal.allowableFrontCPO || 'N/A'} | 許容個別予約CPO: ¥${appeal.allowableIndividualReservationCPO || 'N/A'}`);

    // 各アカウントの配信中広告数を取得
    let activeAdCount = 0;
    for (const adv of appeal.advertisers) {
      const count = await prisma.ad.count({
        where: {
          status: 'ENABLE',
          adGroup: { campaign: { advertiserId: adv.id } },
        },
      });
      activeAdCount += count;
      if (count > 0) {
        console.log(`   └ ${adv.name || adv.tiktokAdvertiserId}: ${count}件配信中`);
      }
    }
    console.log(`   アカウント: ${appeal.advertisers.length} | 配信中広告: ${activeAdCount}件`);

    const registrationPath = `TikTok広告-${appeal.name}`;

    // CV数
    let cv7 = 0, cv30 = 0;
    if (appeal.cvSpreadsheetUrl) {
      const spreadsheetId = extractSpreadsheetId(appeal.cvSpreadsheetUrl);
      cv7 = await countRegistrationPath(spreadsheetId, 'TT_オプト', registrationPath, days7ago, today);
      cv30 = await countRegistrationPath(spreadsheetId, 'TT_オプト', registrationPath, days30ago, today);
      console.log(`   CV数: 7日=${cv7}件, 30日=${cv30}件`);
    } else {
      console.log(`   CV数: スプシ未設定`);
    }

    // フロント販売
    let front7 = 0, front30 = 0;
    if (appeal.frontSpreadsheetUrl) {
      const spreadsheetId = extractSpreadsheetId(appeal.frontSpreadsheetUrl);
      const oto7 = await countRegistrationPath(spreadsheetId, 'TT【OTO】', registrationPath, days7ago, today);
      const day3_7 = await countRegistrationPath(spreadsheetId, 'TT【3day】', registrationPath, days7ago, today);
      front7 = oto7 + day3_7;
      const oto30 = await countRegistrationPath(spreadsheetId, 'TT【OTO】', registrationPath, days30ago, today);
      const day3_30 = await countRegistrationPath(spreadsheetId, 'TT【3day】', registrationPath, days30ago, today);
      front30 = oto30 + day3_30;
      console.log(`   フロント販売: 7日=${front7}件, 30日=${front30}件`);
    } else {
      console.log(`   フロント販売: スプシ未設定`);
    }

    // 個別予約
    let res7 = 0, res30 = 0;
    const channelType = appeal.channelType as string;
    if (['SNS', 'AI', 'SEMINAR'].includes(channelType)) {
      res7 = await countIndividualReservation(channelType, registrationPath, days7ago, today);
      res30 = await countIndividualReservation(channelType, registrationPath, days30ago, today);
      console.log(`   個別予約: 7日=${res7}件, 30日=${res30}件`);
    }

    // 支出（DB - Metric経由）
    const advIds = appeal.advertisers.map(a => a.id);
    let spend7 = 0, spend30 = 0;
    if (advIds.length > 0) {
      const s7 = await prisma.metric.aggregate({
        where: {
          entityType: 'AD',
          ad: { adGroup: { campaign: { advertiserId: { in: advIds } } } },
          statDate: { gte: days7ago, lt: today },
        },
        _sum: { spend: true },
      });
      const s30 = await prisma.metric.aggregate({
        where: {
          entityType: 'AD',
          ad: { adGroup: { campaign: { advertiserId: { in: advIds } } } },
          statDate: { gte: days30ago, lt: today },
        },
        _sum: { spend: true },
      });
      spend7 = s7._sum.spend || 0;
      spend30 = s30._sum.spend || 0;
      console.log(`   支出: 7日=¥${spend7.toLocaleString()}, 30日=¥${spend30.toLocaleString()}`);
    }

    // CPA/CPO計算
    const cpa7 = cv7 > 0 ? Math.round(spend7 / cv7) : null;
    const cpa30 = cv30 > 0 ? Math.round(spend30 / cv30) : null;
    const frontCPO7 = front7 > 0 ? Math.round(spend7 / front7) : null;
    const frontCPO30 = front30 > 0 ? Math.round(spend30 / front30) : null;
    const resCPO7 = res7 > 0 ? Math.round(spend7 / res7) : null;
    const resCPO30 = res30 > 0 ? Math.round(spend30 / res30) : null;

    console.log(`   ---- KPI計算 ----`);
    console.log(`   CPA: 7日=${cpa7 ? `¥${cpa7.toLocaleString()}` : 'N/A'}, 30日=${cpa30 ? `¥${cpa30.toLocaleString()}` : 'N/A'} (許容: ¥${appeal.allowableCPA || 'N/A'})`);
    console.log(`   フロントCPO: 7日=${frontCPO7 ? `¥${frontCPO7.toLocaleString()}` : 'N/A'}, 30日=${frontCPO30 ? `¥${frontCPO30.toLocaleString()}` : 'N/A'} (許容: ¥${appeal.allowableFrontCPO || 'N/A'})`);
    console.log(`   個別予約CPO: 7日=${resCPO7 ? `¥${resCPO7.toLocaleString()}` : 'N/A'}, 30日=${resCPO30 ? `¥${resCPO30.toLocaleString()}` : 'N/A'} (許容: ¥${appeal.allowableIndividualReservationCPO || 'N/A'})`);

    // KPI達成判定
    const kpiMet = (appeal.allowableCPA && cpa30 && cpa30 <= appeal.allowableCPA) ||
                   (appeal.allowableFrontCPO && frontCPO30 && frontCPO30 <= appeal.allowableFrontCPO);
    console.log(`   ★ KPI達成: ${kpiMet ? '✅ YES' : '❌ NO'} | CV30日ボリューム: ${cv30}件`);

    results.push({
      name: appeal.name,
      channelType: appeal.channelType,
      cv7, cv30, front7, front30, res7, res30,
      spend7, spend30,
      cpa7, cpa30, frontCPO7, frontCPO30, resCPO7, resCPO30,
      kpiMet,
      activeAdCount,
      allowableCPA: appeal.allowableCPA,
      allowableFrontCPO: appeal.allowableFrontCPO,
      allowableIndividualReservationCPO: appeal.allowableIndividualReservationCPO,
    });
  }

  // サマリー
  console.log(`\n\n${'='.repeat(60)}`);
  console.log('📋 全導線サマリー（30日実績）');
  console.log('訴求名'.padEnd(20) + 'CV数'.padStart(6) + 'フロント'.padStart(8) + '個別予約'.padStart(8) + '支出'.padStart(12) + 'CPA'.padStart(10) + 'fCPO'.padStart(10) + 'KPI'.padStart(6));
  console.log('-'.repeat(80));
  for (const r of results.sort((a, b) => b.cv30 - a.cv30)) {
    console.log(
      r.name.padEnd(20) +
      String(r.cv30).padStart(6) +
      String(r.front30).padStart(8) +
      String(r.res30).padStart(8) +
      `¥${r.spend30.toLocaleString()}`.padStart(12) +
      (r.cpa30 ? `¥${r.cpa30.toLocaleString()}` : 'N/A').padStart(10) +
      (r.frontCPO30 ? `¥${r.frontCPO30.toLocaleString()}` : 'N/A').padStart(10) +
      (r.kpiMet ? '✅' : '❌').padStart(6)
    );
  }

  await prisma.$disconnect();
}

main().catch(console.error);
