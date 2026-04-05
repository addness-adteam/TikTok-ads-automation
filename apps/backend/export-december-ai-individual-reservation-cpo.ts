/**
 * AI導線 2025年12月の個別予約CRごとの個別予約CPO算出スクリプト
 *
 * 対象期間: 2025/12/1 〜 2025/12/31
 * 対象: AI導線のみ（個別予約があったCR）
 * 出力: CSV（LP-CR、広告名、消化金額、個別予約数、個別予約CPO）
 */

import { google } from 'googleapis';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

// ============================================================================
// 設定
// ============================================================================

/** 個別予約スプレッドシート */
const RESERVATION_SPREADSHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

/** 対象期間: 2025年12月 */
const START_DATE = '2025-12-01';
const END_DATE = '2025-12-31';

/** AIタブ設定 */
const AI_SHEET = { sheetName: 'AI', dateColumnIndex: 0, pathColumnIndex: 46 };

/** AI導線アカウント */
const AI_ADVERTISERS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
];

const TIKTOK_API_BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';

// ============================================================================
// Google Sheets
// ============================================================================

function getGoogleSheetsAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

/** 日付文字列をJST Dateにパース */
function parseJSTDate(dateString: string): Date | null {
  try {
    if (!dateString) return null;
    const trimmed = dateString.trim();

    // YYYY/M/D or YYYY/MM/DD
    const slashMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (slashMatch) {
      const year = parseInt(slashMatch[1]);
      const month = parseInt(slashMatch[2]) - 1;
      const day = parseInt(slashMatch[3]);
      return new Date(Date.UTC(year, month, day, -9, 0, 0));
    }

    // ISO形式等
    if (trimmed.includes('+') || trimmed.includes('Z')) {
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * AIタブから2025年12月の個別予約データを取得
 * LP-CRごとに予約数を集計して返す
 */
async function getAIReservations(): Promise<Map<string, { count: number; paths: string[] }>> {
  const auth = getGoogleSheetsAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  console.log(`  シート「${AI_SHEET.sheetName}」を読み取り中...`);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: RESERVATION_SPREADSHEET_ID,
    range: `${AI_SHEET.sheetName}!A:AZ`,
  });

  const rows = response.data.values || [];
  if (!rows || rows.length === 0) {
    console.log('    データなし');
    return new Map();
  }

  const startDate = new Date(`${START_DATE}T00:00:00+09:00`);
  const endDate = new Date(`${END_DATE}T23:59:59+09:00`);

  const reservationsByLPCR = new Map<string, { count: number; paths: string[] }>();
  let totalCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateValue = row[AI_SHEET.dateColumnIndex];
    const pathValue = row[AI_SHEET.pathColumnIndex];

    if (!dateValue) continue;

    const rowDate = parseJSTDate(String(dateValue));
    if (!rowDate) continue;
    if (rowDate < startDate || rowDate > endDate) continue;

    if (!pathValue) continue;

    const lines = String(pathValue).split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const lpCr = extractLPCRFromPath(trimmed);
      if (!lpCr) continue;

      const existing = reservationsByLPCR.get(lpCr) || { count: 0, paths: [] };
      existing.count++;
      if (!existing.paths.includes(trimmed)) {
        existing.paths.push(trimmed);
      }
      reservationsByLPCR.set(lpCr, existing);
      totalCount++;
    }
  }

  console.log(`    ${totalCount}件の個別予約を検出（${reservationsByLPCR.size}種類のLP-CR）`);
  return reservationsByLPCR;
}

// ============================================================================
// TikTok API
// ============================================================================

async function getSmartPlusSpend(
  advertiserId: string,
  accessToken: string,
): Promise<Map<string, number>> {
  const spendMap = new Map<string, number>();

  try {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/material_report/overview/`, {
        headers: { 'Access-Token': accessToken },
        params: {
          advertiser_id: advertiserId,
          dimensions: JSON.stringify(['smart_plus_ad_id', 'main_material_id']),
          metrics: JSON.stringify(['spend']),
          start_date: START_DATE,
          end_date: END_DATE,
          page,
          page_size: 100,
        },
      });

      const list = response.data.data?.list || [];
      if (list.length > 0) {
        for (const item of list) {
          const adId = item.dimensions?.smart_plus_ad_id;
          const spend = parseFloat(item.metrics?.spend || '0');
          spendMap.set(adId, (spendMap.get(adId) || 0) + spend);
        }

        const totalPages = Math.ceil((response.data.data?.page_info?.total_number || 0) / 100);
        hasMore = page < totalPages;
        page++;
      } else {
        hasMore = false;
      }
    }
  } catch (error: any) {
    console.error(`  Smart+ API エラー (${advertiserId}):`, error.response?.data || error.message);
  }

  return spendMap;
}

async function getAuctionAdSpend(
  advertiserId: string,
  accessToken: string,
): Promise<Map<string, number>> {
  const spendMap = new Map<string, number>();

  try {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/report/integrated/get/`, {
        headers: { 'Access-Token': accessToken },
        params: {
          advertiser_id: advertiserId,
          report_type: 'BASIC',
          data_level: 'AUCTION_AD',
          dimensions: JSON.stringify(['ad_id']),
          metrics: JSON.stringify(['spend']),
          start_date: START_DATE,
          end_date: END_DATE,
          page,
          page_size: 1000,
        },
      });

      const list = response.data.data?.list || [];
      if (list.length > 0) {
        for (const item of list) {
          const adId = item.dimensions?.ad_id;
          const spend = parseFloat(item.metrics?.spend || '0');
          if (spend > 0) {
            spendMap.set(adId, (spendMap.get(adId) || 0) + spend);
          }
        }

        const totalPages = Math.ceil((response.data.data?.page_info?.total_number || 0) / 1000);
        hasMore = page < totalPages;
        page++;
      } else {
        hasMore = false;
      }
    }
  } catch (error: any) {
    console.error(`  通常レポートAPI エラー (${advertiserId}):`, error.response?.data || error.message);
  }

  return spendMap;
}

// ============================================================================
// ユーティリティ
// ============================================================================

function extractLPCRFromAdName(adName: string): string | null {
  const parts = adName.split('/');
  if (parts.length < 4) return null;
  const lastPart = parts[parts.length - 1];
  const match = lastPart.match(/(LP\d+-CR\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

function extractLPCRFromPath(registrationPath: string): string | null {
  const match = registrationPath.match(/(LP\d+-CR\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

// ============================================================================
// メイン処理
// ============================================================================

async function main() {
  try {
    console.log('=== AI導線 2025年12月 CRごとの個別予約CPO算出 ===\n');
    console.log(`対象期間: ${START_DATE} 〜 ${END_DATE}`);
    console.log(`対象: AI導線のみ（個別予約があったCR）`);
    console.log(`個別予約スプレッドシート: ${RESERVATION_SPREADSHEET_ID}\n`);

    // Step 1: 個別予約データ取得
    console.log('--- Step 1: 個別予約データ取得 ---');
    const reservationsByLPCR = await getAIReservations();

    if (reservationsByLPCR.size === 0) {
      console.log('\n2025年12月の個別予約データが見つかりませんでした。');
      return;
    }

    for (const [lpCr, data] of reservationsByLPCR) {
      console.log(`    ${lpCr}: ${data.count}件`);
    }

    // Step 2: AI導線アカウントの広告費を取得
    console.log('\n--- Step 2: 広告費を取得 ---');

    const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('TIKTOK_ACCESS_TOKEN が設定されていません');
    }

    // LP-CRごとの広告費と広告名を集計
    const spendByLPCR = new Map<string, { spend: number; adNames: string[] }>();

    for (const advertiser of AI_ADVERTISERS) {
      console.log(`\n  ${advertiser.name} (${advertiser.id}):`);

      // DBから広告名一覧を取得
      const dbAdvertiser = await prisma.advertiser.findFirst({
        where: { tiktokAdvertiserId: advertiser.id },
        include: {
          campaigns: {
            include: {
              adGroups: {
                include: {
                  ads: { select: { tiktokId: true, name: true } },
                },
              },
            },
          },
        },
      });

      if (!dbAdvertiser) {
        console.log(`    DB未登録`);
        continue;
      }

      const adNameMap = new Map<string, string>();
      for (const campaign of dbAdvertiser.campaigns) {
        for (const adGroup of campaign.adGroups) {
          for (const ad of adGroup.ads) {
            adNameMap.set(ad.tiktokId, ad.name);
          }
        }
      }
      console.log(`    DB広告数: ${adNameMap.size}`);

      const smartPlusSpend = await getSmartPlusSpend(advertiser.id, accessToken);
      console.log(`    Smart+広告費データ: ${smartPlusSpend.size}件`);

      const auctionSpend = await getAuctionAdSpend(advertiser.id, accessToken);
      console.log(`    通常広告費データ: ${auctionSpend.size}件`);

      // Smart+の広告費をLP-CRにマッピング
      for (const [adId, spend] of smartPlusSpend) {
        const adName = adNameMap.get(adId);
        if (!adName) continue;

        const lpCr = extractLPCRFromAdName(adName);
        if (!lpCr) continue;

        const existing = spendByLPCR.get(lpCr) || { spend: 0, adNames: [] };
        existing.spend += spend;
        if (!existing.adNames.includes(adName)) {
          existing.adNames.push(adName);
        }
        spendByLPCR.set(lpCr, existing);
      }

      // 通常広告の広告費もLP-CRにマッピング（Smart+で既にカウント済みのadIdはスキップ）
      for (const [adId, spend] of auctionSpend) {
        if (smartPlusSpend.has(adId)) continue;

        const adName = adNameMap.get(adId);
        if (!adName) continue;

        const lpCr = extractLPCRFromAdName(adName);
        if (!lpCr) continue;

        const existing = spendByLPCR.get(lpCr) || { spend: 0, adNames: [] };
        existing.spend += spend;
        if (!existing.adNames.includes(adName)) {
          existing.adNames.push(adName);
        }
        spendByLPCR.set(lpCr, existing);
      }

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Step 3: CPO算出 & 出力（個別予約があったCRのみ）
    console.log('\n\n========================================');
    console.log('=== AI導線 2025年12月 個別予約CPO結果 ===');
    console.log(`=== 期間: ${START_DATE} 〜 ${END_DATE} ===`);
    console.log('=== 対象: 個別予約があったCRのみ ===');
    console.log('========================================\n');

    interface CPOResult {
      lpCr: string;
      reservations: number;
      spend: number;
      cpo: number | null;
      adNames: string[];
    }

    const results: CPOResult[] = [];

    // 個別予約があったCRのみ対象
    for (const [lpCr, resData] of reservationsByLPCR) {
      const spendData = spendByLPCR.get(lpCr);
      const spend = spendData?.spend || 0;
      const cpo = resData.count > 0 && spend > 0 ? spend / resData.count : null;

      results.push({
        lpCr,
        reservations: resData.count,
        spend,
        cpo,
        adNames: spendData?.adNames || [],
      });
    }

    // CPOが低い順（良い順）
    results.sort((a, b) => {
      if (a.cpo === null && b.cpo === null) return b.spend - a.spend;
      if (a.cpo === null) return 1;
      if (b.cpo === null) return -1;
      return a.cpo - b.cpo;
    });

    // コンソール表示
    console.log('LP-CR          | 予約数 | 消化金額       | 個別予約CPO');
    console.log('---------------|--------|---------------|---------------');

    for (const r of results) {
      const lpCrPad = r.lpCr.padEnd(14);
      const resPad = r.reservations.toString().padStart(4);
      const spendStr = `¥${Math.round(r.spend).toLocaleString()}`.padStart(13);
      const cpoStr = r.cpo !== null
        ? `¥${Math.round(r.cpo).toLocaleString()}`.padStart(13)
        : '  広告費なし'.padStart(13);

      console.log(`${lpCrPad} | ${resPad} | ${spendStr} | ${cpoStr}`);
    }

    const totalRes = results.reduce((s, r) => s + r.reservations, 0);
    const totalSpend = results.reduce((s, r) => s + r.spend, 0);
    const overallCPO = totalRes > 0 && totalSpend > 0 ? totalSpend / totalRes : null;
    console.log('---------------|--------|---------------|---------------');
    console.log(
      `${'合計'.padEnd(14)} | ${totalRes.toString().padStart(4)} | ${('¥' + Math.round(totalSpend).toLocaleString()).padStart(13)} | ${overallCPO !== null ? ('¥' + Math.round(overallCPO).toLocaleString()).padStart(13) : '      N/A'.padStart(13)}`,
    );

    // 広告費なしのCR一覧
    const noSpendCRs = results.filter(r => r.spend === 0);
    if (noSpendCRs.length > 0) {
      console.log('\n⚠️ 予約はあるが広告費が取得できないCR:');
      for (const r of noSpendCRs) {
        console.log(`  ${r.lpCr}: ${r.reservations}件の予約`);
      }
      console.log('  → 12月に配信されていないCR、または広告名のLP-CRパターンが一致しない可能性があります');
    }

    // 詳細: 各CRに紐づく広告一覧
    console.log('\n\n=== 詳細: 各CRに紐づく広告一覧 ===');
    for (const r of results) {
      console.log(`\n${r.lpCr} (予約: ${r.reservations}件, CPO: ${r.cpo !== null ? '¥' + Math.round(r.cpo).toLocaleString() : 'N/A'}):`);
      if (r.adNames.length > 0) {
        for (const adName of r.adNames) {
          console.log(`  - ${adName}`);
        }
      } else {
        console.log('  (該当広告なし)');
      }
    }

    // CSV出力
    const outputDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const csvHeaders = ['LP-CR', '広告名', '消化金額', '個別予約数', '個別予約CPO'];
    const csvRows: string[] = [];

    for (const r of results) {
      if (r.adNames.length > 0) {
        // 1行目にLP-CR単位の集計値、広告名は最初の1つ
        csvRows.push([
          r.lpCr,
          `"${r.adNames[0].replace(/"/g, '""')}"`,
          Math.round(r.spend),
          r.reservations,
          r.cpo !== null ? Math.round(r.cpo) : 'N/A',
        ].join(','));
        // 2つ目以降の広告名は広告名だけ記載
        for (let i = 1; i < r.adNames.length; i++) {
          csvRows.push([
            '',
            `"${r.adNames[i].replace(/"/g, '""')}"`,
            '',
            '',
            '',
          ].join(','));
        }
      } else {
        csvRows.push([
          r.lpCr,
          '(該当広告なし)',
          0,
          r.reservations,
          'N/A',
        ].join(','));
      }
    }

    csvRows.push('');
    csvRows.push([
      '合計', '', Math.round(totalSpend), totalRes,
      overallCPO !== null ? Math.round(overallCPO) : 'N/A',
    ].join(','));

    const bom = '\uFEFF';
    const csvContent = [
      `AI導線 2025年12月 個別予約CPO一覧（${START_DATE} 〜 ${END_DATE}）`,
      '対象: 個別予約があったCRのみ',
      '',
      csvHeaders.join(','),
      ...csvRows,
    ].join('\n');

    const outputPath = path.join(outputDir, `AI導線_2025年12月_個別予約CPO_${START_DATE}_${END_DATE}.csv`);
    fs.writeFileSync(outputPath, bom + csvContent, 'utf-8');

    console.log(`\n\nCSVファイル出力完了: ${outputPath}`);

  } catch (error) {
    console.error('エラー:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
