/**
 * 2025年1月〜12月の全CR成績を全導線で確認
 * CV数・フロント販売・個別予約・支出 → CPA/fCPO/個別予約CPOを算出
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

const INDIVIDUAL_RESERVATION_SPREADSHEET_ID = '1WdvXZiGakoRFTGqZGCBAKlfZgjVP4xhBPE55oMVgsic';

const START_DATE = new Date(2025, 0, 1);
const END_DATE = new Date(2026, 0, 1); // exclusive

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

async function getSheetData(spreadsheetId: string, sheetName: string, range = 'A:AZ'): Promise<any[][]> {
  try {
    const res = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!${range}`,
    });
    return res.data.values || [];
  } catch (e: any) {
    console.log(`  ⚠ シート「${sheetName}」エラー: ${e.message?.substring(0, 100)}`);
    return [];
  }
}

// CR名からチャネルを判定
function getChannel(crPath: string): string | null {
  if (crPath.includes('-AI-')) return 'AI';
  if (crPath.includes('-SNS-')) return 'SNS';
  if (crPath.includes('-スキルプラス-')) return 'SP';
  return null;
}

// CR名から短縮キーを作成 (例: TikTok広告-AI-LP1-CR01047 → AI-LP1-CR01047)
function crKey(crPath: string): string {
  return crPath.replace('TikTok広告-', '');
}

interface CRStats {
  fullPath: string;
  channel: string;
  cv: number;
  frontSales: number;
  individualReservation: number;
  spend: number;
}

async function main() {
  const crMap = new Map<string, CRStats>();

  function getOrCreate(fullPath: string): CRStats {
    const key = crKey(fullPath);
    if (!crMap.has(key)) {
      crMap.set(key, {
        fullPath,
        channel: getChannel(fullPath) || '?',
        cv: 0,
        frontSales: 0,
        individualReservation: 0,
        spend: 0,
      });
    }
    return crMap.get(key)!;
  }

  // ========== 1. CV数（TT_オプト） ==========
  console.log('=== 1. CVデータ取得中... ===');
  const appeals = await prisma.appeal.findMany({ include: { advertisers: true } });

  for (const appeal of appeals) {
    if (!appeal.cvSpreadsheetUrl) continue;
    const spreadsheetId = extractSpreadsheetId(appeal.cvSpreadsheetUrl);
    const rows = await getSheetData(spreadsheetId, 'TT_オプト', 'A:Z');
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
      getOrCreate(pathValue).cv++;
    }
    console.log(`  ${appeal.name}: CV取得完了 (${rows.length}行)`);
  }

  // ========== 2. フロント販売（TT【OTO】+ TT【3day】） ==========
  console.log('\n=== 2. フロント販売データ取得中... ===');
  for (const appeal of appeals) {
    if (!appeal.frontSpreadsheetUrl) continue;
    const spreadsheetId = extractSpreadsheetId(appeal.frontSpreadsheetUrl);

    for (const sheetName of ['TT【OTO】', 'TT【3day】']) {
      const rows = await getSheetData(spreadsheetId, sheetName, 'A:Z');
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
        getOrCreate(pathValue).frontSales++;
      }
      console.log(`  ${appeal.name} - ${sheetName}: フロント取得完了`);
    }
  }

  // ========== 3. 個別予約（新スプレッドシート） ==========
  console.log('\n=== 3. 個別予約データ取得中... ===');
  const resRows = await getSheetData(INDIVIDUAL_RESERVATION_SPREADSHEET_ID, 'シート1', 'A:H');
  console.log(`  個別予約シート: ${resRows.length}行`);

  if (resRows.length > 0) {
    // [0]面談予約日 [2]流入経路 [7]CR名
    for (let i = 1; i < resRows.length; i++) {
      const row = resRows[i];
      const dateValue = String(row[0] || '');
      const crName = String(row[7] || '').trim();
      // CR名にTikTok広告が含まれるものをカウント
      if (!crName.startsWith('TikTok広告-')) continue;
      const rowDate = parseDate(dateValue);
      if (!rowDate || rowDate < START_DATE || rowDate >= END_DATE) continue;

      // CR名にカンマ区切りで複数入ってる場合あり
      const crNames = crName.split(',').map(s => s.trim()).filter(s => s.startsWith('TikTok広告-'));
      for (const cn of crNames) {
        getOrCreate(cn).individualReservation++;
      }
    }
    console.log(`  個別予約: TikTok広告のCR抽出完了`);
  }

  // ========== 4. 支出（DB Metric - registrationPath） ==========
  console.log('\n=== 4. 支出データ取得中... ===');

  // まずregistrationPathでグループ化を試みる
  const spendByPath = await prisma.metric.groupBy({
    by: ['registrationPath'],
    where: {
      entityType: 'AD',
      statDate: { gte: START_DATE, lt: END_DATE },
      registrationPath: { not: null },
    },
    _sum: { spend: true },
  });

  let matchedSpend = 0;
  for (const item of spendByPath) {
    if (item.registrationPath && item.registrationPath.startsWith('TikTok広告-')) {
      const stats = crMap.get(crKey(item.registrationPath));
      if (stats) {
        stats.spend += item._sum.spend || 0;
        matchedSpend++;
      } else {
        // スプシにはないけどDBにはあるCR
        getOrCreate(item.registrationPath).spend += item._sum.spend || 0;
      }
    }
  }
  console.log(`  registrationPathマッチ: ${matchedSpend}件`);

  // registrationPathがnullのメトリクス（大半のケース）→ 広告名からCR推定
  // Ad名にCR番号が含まれるケースを処理
  const adsWithMetrics = await prisma.$queryRaw<Array<{
    adName: string;
    advertiserId: string;
    totalSpend: number;
  }>>`
    SELECT a.name as "adName", c."advertiserId", SUM(m.spend) as "totalSpend"
    FROM metrics m
    JOIN ads a ON m."adId" = a.id
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    WHERE m."entityType" = 'AD'
      AND m."statDate" >= ${START_DATE}
      AND m."statDate" < ${END_DATE}
      AND m."registrationPath" IS NULL
    GROUP BY a.name, c."advertiserId"
  `;

  // 広告名からCR番号を抽出してマッチング
  // 広告名にはCR番号が直接入っていない場合が多いので、
  // registrationPathがnullの支出は個別CRに紐付けられない
  console.log(`  registrationPath=NULLの広告: ${adsWithMetrics.length}件`);
  const nullSpendTotal = adsWithMetrics.reduce((s, a) => s + Number(a.totalSpend), 0);
  console.log(`  紐付け不可の支出合計: ¥${nullSpendTotal.toLocaleString()}`);

  // ========== 5. 結果出力 ==========
  console.log('\n\n' + '='.repeat(100));
  console.log('📊 2025年 全CR成績一覧（2025/01〜2025/12）');
  console.log('='.repeat(100));

  // チャネル別に出力
  for (const channel of ['AI', 'SNS', 'SP']) {
    const channelCRs = Array.from(crMap.entries())
      .filter(([_, stats]) => stats.channel === channel)
      .sort((a, b) => b[1].cv - a[1].cv);

    console.log(`\n${'─'.repeat(100)}`);
    console.log(`📌 ${channel}導線 (${channelCRs.length}CR)`);
    console.log('─'.repeat(100));
    console.log(
      'CR'.padEnd(30) +
      'CV'.padStart(6) +
      'フロント'.padStart(10) +
      '個別予約'.padStart(10) +
      '支出'.padStart(14) +
      'CPA'.padStart(10) +
      'fCPO'.padStart(10) +
      '個別予約CPO'.padStart(14)
    );
    console.log('-'.repeat(100));

    let totalCV = 0, totalFront = 0, totalRes = 0, totalSpend = 0;

    for (const [key, stats] of channelCRs) {
      const cpa = stats.cv > 0 && stats.spend > 0 ? Math.round(stats.spend / stats.cv) : null;
      const fCPO = stats.frontSales > 0 && stats.spend > 0 ? Math.round(stats.spend / stats.frontSales) : null;
      const resCPO = stats.individualReservation > 0 && stats.spend > 0 ? Math.round(stats.spend / stats.individualReservation) : null;

      totalCV += stats.cv;
      totalFront += stats.frontSales;
      totalRes += stats.individualReservation;
      totalSpend += stats.spend;

      console.log(
        key.padEnd(30) +
        String(stats.cv).padStart(6) +
        String(stats.frontSales).padStart(10) +
        String(stats.individualReservation).padStart(10) +
        (stats.spend > 0 ? `¥${Math.round(stats.spend).toLocaleString()}` : '-').padStart(14) +
        (cpa ? `¥${cpa.toLocaleString()}` : '-').padStart(10) +
        (fCPO ? `¥${fCPO.toLocaleString()}` : '-').padStart(10) +
        (resCPO ? `¥${resCPO.toLocaleString()}` : '-').padStart(14)
      );
    }

    console.log('-'.repeat(100));
    const totalCPA = totalCV > 0 && totalSpend > 0 ? Math.round(totalSpend / totalCV) : null;
    const totalFCPO = totalFront > 0 && totalSpend > 0 ? Math.round(totalSpend / totalFront) : null;
    const totalResCPO = totalRes > 0 && totalSpend > 0 ? Math.round(totalSpend / totalRes) : null;
    console.log(
      '合計'.padEnd(30) +
      String(totalCV).padStart(6) +
      String(totalFront).padStart(10) +
      String(totalRes).padStart(10) +
      (totalSpend > 0 ? `¥${Math.round(totalSpend).toLocaleString()}` : '-').padStart(14) +
      (totalCPA ? `¥${totalCPA.toLocaleString()}` : '-').padStart(10) +
      (totalFCPO ? `¥${totalFCPO.toLocaleString()}` : '-').padStart(10) +
      (totalResCPO ? `¥${totalResCPO.toLocaleString()}` : '-').padStart(14)
    );
  }

  // ========== 6. 横展開候補（CV多い + 個別予約あり） ==========
  console.log('\n\n' + '='.repeat(100));
  console.log('🏆 横展開候補（CV10件以上 & 個別予約1件以上）');
  console.log('='.repeat(100));

  const candidates = Array.from(crMap.entries())
    .filter(([_, s]) => s.cv >= 10 && s.individualReservation >= 1)
    .sort((a, b) => b[1].individualReservation - a[1].individualReservation);

  console.log(
    'CR'.padEnd(30) +
    'CH'.padStart(4) +
    'CV'.padStart(6) +
    'フロント'.padStart(10) +
    '個別予約'.padStart(10) +
    '支出'.padStart(14) +
    'CPA'.padStart(10) +
    '個別予約CPO'.padStart(14)
  );
  console.log('-'.repeat(100));

  for (const [key, stats] of candidates) {
    const cpa = stats.cv > 0 && stats.spend > 0 ? Math.round(stats.spend / stats.cv) : null;
    const resCPO = stats.individualReservation > 0 && stats.spend > 0 ? Math.round(stats.spend / stats.individualReservation) : null;
    console.log(
      key.padEnd(30) +
      stats.channel.padStart(4) +
      String(stats.cv).padStart(6) +
      String(stats.frontSales).padStart(10) +
      String(stats.individualReservation).padStart(10) +
      (stats.spend > 0 ? `¥${Math.round(stats.spend).toLocaleString()}` : '-').padStart(14) +
      (cpa ? `¥${cpa.toLocaleString()}` : '-').padStart(10) +
      (resCPO ? `¥${resCPO.toLocaleString()}` : '-').padStart(14)
    );
  }

  await prisma.$disconnect();
}

main().catch(console.error);
