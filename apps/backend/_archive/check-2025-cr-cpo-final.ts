/**
 * 2025年 CR単位の個別予約CPOを算出
 * - 支出: DB広告名末尾の LP{n}-CR{xxxxx} パターンからCR番号を抽出
 * - CV/フロント: CVスプシ
 * - 個別予約: 新スプシ CR名列 + 流入経路列
 */
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheetsApi = google.sheets({ version: 'v4', auth });

const RES_SPREADSHEET_ID = '1WdvXZiGakoRFTGqZGCBAKlfZgjVP4xhBPE55oMVgsic';
const START_DATE = new Date(2025, 0, 1);
const END_DATE = new Date(2026, 0, 1);

const ACCOUNT_CHANNEL: Record<string, string> = {
  '7468288053866561553': 'AI',
  '7523128243466551303': 'AI',
  '7543540647266074641': 'AI',
  '7580666710525493255': 'AI',
  '7247073333517238273': 'SNS',
  '7543540100849156112': 'SNS',
  '7543540381615800337': 'SNS',
  '7474920444831875080': 'SP',
  '7592868952431362066': 'SP',
};

function extractSpreadsheetId(url: string): string {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Invalid URL: ${url}`);
  return match[1];
}

function parseDate(dateString: string): Date | null {
  if (!dateString) return null;
  const match = dateString.trim().match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!match) return null;
  return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
}

// 広告名・CR名から "チャネル-LPn-CRxxxxx" キーを抽出
function extractCrKey(text: string, channel?: string): string | null {
  // パターン1: LP{n}-CR{番号} (広告名末尾)
  const lpCrMatch = text.match(/(LP\d+)-(CR\d+)/);
  if (lpCrMatch && channel) {
    return `${channel}-${lpCrMatch[1]}-${lpCrMatch[2]}`;
  }
  // パターン2: TikTok広告-{チャネル}-LP{n}-CR{番号} (スプシ登録経路)
  const fullMatch = text.match(/TikTok広告-(AI|SNS|スキルプラス)-(LP\d+)-(CR\d+)/);
  if (fullMatch) {
    const ch = fullMatch[1] === 'スキルプラス' ? 'SP' : fullMatch[1];
    return `${ch}-${fullMatch[2]}-${fullMatch[3]}`;
  }
  return null;
}

async function getSheetData(spreadsheetId: string, sheetName: string, range = 'A:Z'): Promise<any[][]> {
  try {
    const res = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!${range}`,
    });
    return res.data.values || [];
  } catch (e: any) {
    return [];
  }
}

interface CRStats {
  channel: string;
  cv: number;
  frontSales: number;
  individualReservation: number;
  spend: number;
}

async function main() {
  const crMap = new Map<string, CRStats>();

  function getOrCreate(key: string, channel: string): CRStats {
    if (!crMap.has(key)) {
      crMap.set(key, { channel, cv: 0, frontSales: 0, individualReservation: 0, spend: 0 });
    }
    return crMap.get(key)!;
  }

  // ===== 1. 支出（DB広告名からCR抽出） =====
  console.log('=== 1. 支出データ取得中... ===');
  const spendData = await prisma.$queryRaw<Array<{
    adName: string;
    tiktokAdvId: string;
    totalSpend: number;
  }>>`
    SELECT a.name as "adName", adv."tiktokAdvertiserId" as "tiktokAdvId",
           SUM(m.spend) as "totalSpend"
    FROM metrics m
    JOIN ads a ON m."adId" = a.id
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    JOIN advertisers adv ON c."advertiserId" = adv.id
    WHERE m."entityType" = 'AD'
      AND m."statDate" >= ${START_DATE}
      AND m."statDate" < ${END_DATE}
    GROUP BY a.name, adv."tiktokAdvertiserId"
  `;

  let matchedSpend = 0;
  let unmatchedSpend = 0;
  for (const row of spendData) {
    const channel = ACCOUNT_CHANNEL[row.tiktokAdvId];
    if (!channel) continue;
    const crKey = extractCrKey(row.adName || '', channel);
    if (crKey) {
      getOrCreate(crKey, channel).spend += Number(row.totalSpend);
      matchedSpend++;
    } else {
      unmatchedSpend++;
    }
  }
  console.log(`  CR紐付け成功: ${matchedSpend}件, 紐付け不可: ${unmatchedSpend}件`);

  // ===== 2. CV数（TT_オプト） =====
  console.log('\n=== 2. CVデータ取得中... ===');
  const appeals = await prisma.appeal.findMany({ include: { advertisers: true } });

  for (const appeal of appeals) {
    if (!appeal.cvSpreadsheetUrl) continue;
    const spreadsheetId = extractSpreadsheetId(appeal.cvSpreadsheetUrl);
    const rows = await getSheetData(spreadsheetId, 'TT_オプト');
    if (rows.length === 0) continue;

    const header = rows[0];
    let pathCol = -1, dateCol = -1;
    for (let i = 0; i < header.length; i++) {
      const h = String(header[i] || '').trim();
      if (['登録経路', '流入経路', 'ファネル登録経路'].includes(h)) pathCol = i;
      if (['登録日時', '登録日', 'アクション実行日時', '実行日時'].includes(h)) dateCol = i;
    }
    if (pathCol === -1 || dateCol === -1) continue;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const pathValue = String(row[pathCol] || '');
      const dateValue = String(row[dateCol] || '');
      if (!pathValue.startsWith('TikTok広告-')) continue;
      const rowDate = parseDate(dateValue);
      if (!rowDate || rowDate < START_DATE || rowDate >= END_DATE) continue;
      const key = extractCrKey(pathValue);
      if (key) getOrCreate(key, key.split('-')[0]).cv++;
    }
    console.log(`  ${appeal.name}: 完了`);
  }

  // ===== 3. フロント販売 =====
  console.log('\n=== 3. フロント販売データ取得中... ===');
  for (const appeal of appeals) {
    if (!appeal.frontSpreadsheetUrl) continue;
    const spreadsheetId = extractSpreadsheetId(appeal.frontSpreadsheetUrl);

    for (const sheetName of ['TT【OTO】', 'TT【3day】']) {
      const rows = await getSheetData(spreadsheetId, sheetName);
      if (rows.length === 0) continue;

      const header = rows[0];
      let pathCol = -1, dateCol = -1;
      for (let i = 0; i < header.length; i++) {
        const h = String(header[i] || '').trim();
        if (['登録経路', '流入経路', 'ファネル登録経路'].includes(h)) pathCol = i;
        if (['登録日時', '登録日', 'アクション実行日時', '実行日時'].includes(h)) dateCol = i;
      }
      if (pathCol === -1 || dateCol === -1) continue;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const pathValue = String(row[pathCol] || '');
        const dateValue = String(row[dateCol] || '');
        if (!pathValue.startsWith('TikTok広告-')) continue;
        const rowDate = parseDate(dateValue);
        if (!rowDate || rowDate < START_DATE || rowDate >= END_DATE) continue;
        const key = extractCrKey(pathValue);
        if (key) getOrCreate(key, key.split('-')[0]).frontSales++;
      }
    }
  }

  // ===== 4. 個別予約（CR名列） =====
  console.log('\n=== 4. 個別予約データ取得中... ===');
  const resData = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: RES_SPREADSHEET_ID,
    range: "'シート1'!A:H",
  });
  const resRows = resData.data.values || [];

  for (let i = 1; i < resRows.length; i++) {
    const row = resRows[i];
    const dateValue = String(row[0] || '');
    const crName = String(row[7] || '').trim();
    const rowDate = parseDate(dateValue);
    if (!rowDate || rowDate < START_DATE || rowDate >= END_DATE) continue;

    // CR名にTikTok広告が含まれるもの
    if (crName.includes('TikTok広告-')) {
      const crNames = crName.split(/[,，]/).map(s => s.trim()).filter(s => s.includes('TikTok広告-'));
      for (const cn of crNames) {
        const key = extractCrKey(cn);
        if (key) getOrCreate(key, key.split('-')[0]).individualReservation++;
      }
    }
  }

  // SP: 流入経路ベースでもカウント（CR紐付け不可分は導線合計に含める）
  let spResTotal = 0;
  for (let i = 1; i < resRows.length; i++) {
    const row = resRows[i];
    const dateValue = String(row[0] || '');
    const inflow = String(row[2] || '').trim();
    const rowDate = parseDate(dateValue);
    if (!rowDate || rowDate < START_DATE || rowDate >= END_DATE) continue;
    if (inflow === 'TikTok広告_スキルプラス' || inflow === 'TikTok_スキルプラス') {
      spResTotal++;
    }
  }
  console.log(`  SP個別予約（流入経路ベース）: ${spResTotal}件`);

  // ===== 5. 結果出力 =====
  for (const channel of ['AI', 'SNS', 'SP']) {
    const channelLabel = channel === 'SP' ? 'スキルプラス' : channel;
    const entries = Array.from(crMap.entries())
      .filter(([_, s]) => s.channel === channel && (s.cv > 0 || s.spend > 0 || s.individualReservation > 0))
      .sort((a, b) => b[1].individualReservation - a[1].individualReservation || b[1].cv - a[1].cv);

    console.log(`\n${'='.repeat(120)}`);
    console.log(`📌 ${channelLabel}導線 (${entries.length}CR)`);
    if (channel === 'SP') {
      console.log(`   ※ SP個別予約はCR名列が大半「-」のため、CR紐付けできた分のみ表示。流入経路ベース合計: ${spResTotal}件`);
    }
    console.log('='.repeat(120));
    console.log(
      'CR'.padEnd(22) +
      'CV'.padStart(6) +
      'フロント'.padStart(10) +
      '個別予約'.padStart(10) +
      '支出'.padStart(16) +
      'CPA'.padStart(12) +
      'fCPO'.padStart(12) +
      '個別予約CPO'.padStart(14)
    );
    console.log('-'.repeat(120));

    let totalCV = 0, totalFront = 0, totalRes = 0, totalSpend = 0;
    let displayCount = 0;

    for (const [key, stats] of entries) {
      totalCV += stats.cv;
      totalFront += stats.frontSales;
      totalRes += stats.individualReservation;
      totalSpend += stats.spend;

      // CV>=5 or 個別予約>=1 or 支出>=100000 のCRのみ表示
      if (stats.cv < 5 && stats.individualReservation < 1 && stats.spend < 100000) continue;
      displayCount++;

      const cpa = stats.cv > 0 && stats.spend > 0 ? Math.round(stats.spend / stats.cv) : null;
      const fCPO = stats.frontSales > 0 && stats.spend > 0 ? Math.round(stats.spend / stats.frontSales) : null;
      const resCPO = stats.individualReservation > 0 && stats.spend > 0 ? Math.round(stats.spend / stats.individualReservation) : null;

      console.log(
        key.padEnd(22) +
        String(stats.cv).padStart(6) +
        String(stats.frontSales).padStart(10) +
        String(stats.individualReservation).padStart(10) +
        (stats.spend > 0 ? `¥${Math.round(stats.spend).toLocaleString()}` : '-').padStart(16) +
        (cpa ? `¥${cpa.toLocaleString()}` : '-').padStart(12) +
        (fCPO ? `¥${fCPO.toLocaleString()}` : '-').padStart(12) +
        (resCPO ? `¥${resCPO.toLocaleString()}` : '-').padStart(14)
      );
    }

    console.log('-'.repeat(120));
    const tCPA = totalCV > 0 && totalSpend > 0 ? Math.round(totalSpend / totalCV) : null;
    const tFCPO = totalFront > 0 && totalSpend > 0 ? Math.round(totalSpend / totalFront) : null;
    const tResCPO = totalRes > 0 && totalSpend > 0 ? Math.round(totalSpend / totalRes) : null;
    console.log(
      '合計'.padEnd(22) +
      String(totalCV).padStart(6) +
      String(totalFront).padStart(10) +
      String(totalRes).padStart(10) +
      (totalSpend > 0 ? `¥${Math.round(totalSpend).toLocaleString()}` : '-').padStart(16) +
      (tCPA ? `¥${tCPA.toLocaleString()}` : '-').padStart(12) +
      (tFCPO ? `¥${tFCPO.toLocaleString()}` : '-').padStart(12) +
      (tResCPO ? `¥${tResCPO.toLocaleString()}` : '-').padStart(14)
    );
  }

  await prisma.$disconnect();
}

main().catch(console.error);
