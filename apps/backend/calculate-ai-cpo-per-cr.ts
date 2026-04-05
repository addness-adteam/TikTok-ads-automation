/**
 * AI導線 CRごとの個別予約CPO算出スクリプト
 *
 * 1. スプレッドシートから個別予約者の登録経路を集計
 * 2. AI導線アカウントの広告費を取得（2/1以降）
 * 3. CRごとのCPO（Cost Per Order）を算出
 */

import { google } from 'googleapis';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

// 個別予約スプレッドシート
const RESERVATION_SPREADSHEET_ID = '13x6k01kuazOc03pSJYYeDheWsAxXmD11OCUXluzwAGM';
const RESERVATION_SHEET_NAME = 'TikTok広告_AI_メールアドレス一覧';

// AI導線アカウント
const AI_ADVERTISERS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
];

// 対象期間
const START_DATE = '2026-02-01';
const END_DATE = '2026-02-18'; // 今日

const TIKTOK_API_BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';

/**
 * 1. スプレッドシートから個別予約の登録経路を集計
 */
async function getReservationCounts(): Promise<Map<string, { count: number; emails: string[] }>> {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: RESERVATION_SPREADSHEET_ID,
    range: `${RESERVATION_SHEET_NAME}!A:B`,
  });

  const rows = response.data.values || [];
  const pathCounts = new Map<string, { count: number; emails: string[] }>();

  // ヘッダーをスキップ
  for (let i = 1; i < rows.length; i++) {
    const email = rows[i][0]?.toString().trim();
    const regPath = rows[i][1]?.toString().trim();
    if (!email || !regPath) continue;

    const existing = pathCounts.get(regPath) || { count: 0, emails: [] };
    existing.count++;
    existing.emails.push(email);
    pathCounts.set(regPath, existing);
  }

  return pathCounts;
}

/**
 * 登録経路からCR番号を抽出
 * 例: "TikTok広告-AI-LP1-CR00797" → "CR00797"
 */
function extractCRFromPath(registrationPath: string): string | null {
  const match = registrationPath.match(/(CR\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * 登録経路からLP-CR部分を抽出
 * 例: "TikTok広告-AI-LP1-CR00797" → "LP1-CR00797"
 */
function extractLPCRFromPath(registrationPath: string): string | null {
  const match = registrationPath.match(/(LP\d+-CR\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * 広告名からLP-CR部分を抽出
 * 例: "260201/田中/動画CR/LP1-CR00797" → "LP1-CR00797"
 */
function extractLPCRFromAdName(adName: string): string | null {
  const parts = adName.split('/');
  if (parts.length < 4) return null;
  const lastPart = parts[parts.length - 1];
  const match = lastPart.match(/(LP\d+-CR\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Smart+ APIから広告費を取得
 */
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

/**
 * 通常の広告レポートAPIから広告費を取得
 */
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
          metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
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

async function main() {
  try {
    console.log('=== AI導線 CRごとの個別予約CPO算出 ===\n');
    console.log(`対象期間: ${START_DATE} 〜 ${END_DATE}`);
    console.log(`個別予約スプレッドシート: ${RESERVATION_SPREADSHEET_ID}\n`);

    // ========================================
    // Step 1: スプレッドシートから個別予約数を集計
    // ========================================
    console.log('--- Step 1: 個別予約数を集計 ---');
    const reservationCounts = await getReservationCounts();

    console.log(`  登録経路数: ${reservationCounts.size}`);
    console.log(`  総予約数: ${Array.from(reservationCounts.values()).reduce((s, v) => s + v.count, 0)}`);
    console.log('');

    for (const [path, data] of reservationCounts) {
      const cr = extractCRFromPath(path);
      const lpCr = extractLPCRFromPath(path);
      console.log(`  ${lpCr || path}: ${data.count}件`);
    }

    // ========================================
    // Step 2: AI導線アカウントの広告費を取得
    // ========================================
    console.log('\n--- Step 2: 広告費を取得 ---');
    const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('TIKTOK_ACCESS_TOKEN が設定されていません');
    }

    // LP-CRごとの広告費を集計
    const spendByLPCR = new Map<string, { spend: number; adCount: number; ads: string[] }>();

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

      // 広告一覧をフラット化
      const adNameMap = new Map<string, string>(); // tiktokId -> name
      for (const campaign of dbAdvertiser.campaigns) {
        for (const adGroup of campaign.adGroups) {
          for (const ad of adGroup.ads) {
            adNameMap.set(ad.tiktokId, ad.name);
          }
        }
      }
      console.log(`    DB広告数: ${adNameMap.size}`);

      // Smart+ APIから広告費を取得
      const smartPlusSpend = await getSmartPlusSpend(advertiser.id, accessToken);
      console.log(`    Smart+広告費データ: ${smartPlusSpend.size}件`);

      // 通常レポートAPIからも取得
      const auctionSpend = await getAuctionAdSpend(advertiser.id, accessToken);
      console.log(`    通常広告費データ: ${auctionSpend.size}件`);

      // Smart+の広告費をLP-CRにマッピング
      for (const [adId, spend] of smartPlusSpend) {
        const adName = adNameMap.get(adId);
        if (!adName) continue;

        const lpCr = extractLPCRFromAdName(adName);
        if (!lpCr) continue;

        const existing = spendByLPCR.get(lpCr) || { spend: 0, adCount: 0, ads: [] };
        existing.spend += spend;
        existing.adCount++;
        existing.ads.push(`${adName} (¥${spend.toFixed(0)})`);
        spendByLPCR.set(lpCr, existing);
      }

      // 通常広告の広告費もLP-CRにマッピング
      for (const [adId, spend] of auctionSpend) {
        const adName = adNameMap.get(adId);
        if (!adName) continue;

        const lpCr = extractLPCRFromAdName(adName);
        if (!lpCr) continue;

        // Smart+で既にカウント済みのadIdはスキップ
        if (smartPlusSpend.has(adId)) continue;

        const existing = spendByLPCR.get(lpCr) || { spend: 0, adCount: 0, ads: [] };
        existing.spend += spend;
        existing.adCount++;
        existing.ads.push(`${adName} (¥${spend.toFixed(0)})`);
        spendByLPCR.set(lpCr, existing);
      }

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // ========================================
    // Step 3: CPOを算出
    // ========================================
    console.log('\n\n========================================');
    console.log('=== CRごとの個別予約CPO ===');
    console.log(`=== 期間: ${START_DATE} 〜 ${END_DATE} ===`);
    console.log('========================================\n');

    interface CPOResult {
      lpCr: string;
      cr: string;
      reservations: number;
      spend: number;
      cpo: number | null;
      adCount: number;
    }

    const results: CPOResult[] = [];

    // 予約があるCRと広告費があるCRの全リストを作成
    const allLPCRs = new Set<string>();
    for (const [path] of reservationCounts) {
      const lpCr = extractLPCRFromPath(path);
      if (lpCr) allLPCRs.add(lpCr);
    }
    for (const [lpCr] of spendByLPCR) {
      allLPCRs.add(lpCr);
    }

    for (const lpCr of allLPCRs) {
      // 対応する登録経路を検索
      const regPath = `TikTok広告-AI-${lpCr}`;
      const reservation = reservationCounts.get(regPath);
      const spendData = spendByLPCR.get(lpCr);

      const reservations = reservation?.count || 0;
      const spend = spendData?.spend || 0;
      const cpo = reservations > 0 ? spend / reservations : null;
      const cr = extractCRFromPath(regPath) || lpCr;

      results.push({
        lpCr,
        cr,
        reservations,
        spend,
        cpo,
        adCount: spendData?.adCount || 0,
      });
    }

    // CPOが低い順（良い順）にソート、CPO=nullは最後
    results.sort((a, b) => {
      if (a.cpo === null && b.cpo === null) return b.spend - a.spend;
      if (a.cpo === null) return 1;
      if (b.cpo === null) return -1;
      return a.cpo - b.cpo;
    });

    // テーブル表示
    console.log('LP-CR          | 予約数 | 広告費        | CPO           | 広告数');
    console.log('---------------|--------|---------------|---------------|-------');

    for (const r of results) {
      const lpCrPad = r.lpCr.padEnd(14);
      const resPad = r.reservations.toString().padStart(4);
      const spendStr = `¥${r.spend.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`.padStart(13);
      const cpoStr = r.cpo !== null
        ? `¥${r.cpo.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`.padStart(13)
        : '    予約なし'.padStart(13);
      const adCountStr = r.adCount.toString().padStart(5);

      console.log(`${lpCrPad} | ${resPad} | ${spendStr} | ${cpoStr} | ${adCountStr}`);
    }

    // サマリー
    const totalReservations = results.reduce((s, r) => s + r.reservations, 0);
    const totalSpend = results.reduce((s, r) => s + r.spend, 0);
    const overallCPO = totalReservations > 0 ? totalSpend / totalReservations : null;

    console.log('---------------|--------|---------------|---------------|-------');
    console.log(`${'合計'.padEnd(14)} | ${totalReservations.toString().padStart(4)} | ${('¥' + totalSpend.toLocaleString('ja-JP', { maximumFractionDigits: 0 })).padStart(13)} | ${overallCPO !== null ? ('¥' + overallCPO.toLocaleString('ja-JP', { maximumFractionDigits: 0 })).padStart(13) : '  N/A'.padStart(13)} |`);

    // CRごとの集約（LPをまたいで）
    const byCR = new Map<string, { reservations: number; spend: number }>();
    for (const r of results) {
      const existing = byCR.get(r.cr) || { reservations: 0, spend: 0 };
      existing.reservations += r.reservations;
      existing.spend += r.spend;
      byCR.set(r.cr, existing);
    }

    if (byCR.size !== results.length) {
      console.log('\n\n=== CR単位の集約（LP横断） ===\n');
      console.log('CR番号    | 予約数 | 広告費        | CPO');
      console.log('----------|--------|---------------|---------------');

      const crResults = Array.from(byCR.entries()).map(([cr, data]) => ({
        cr,
        ...data,
        cpo: data.reservations > 0 ? data.spend / data.reservations : null,
      })).sort((a, b) => {
        if (a.cpo === null && b.cpo === null) return b.spend - a.spend;
        if (a.cpo === null) return 1;
        if (b.cpo === null) return -1;
        return a.cpo - b.cpo;
      });

      for (const r of crResults) {
        const crPad = r.cr.padEnd(9);
        const resPad = r.reservations.toString().padStart(4);
        const spendStr = `¥${r.spend.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`.padStart(13);
        const cpoStr = r.cpo !== null
          ? `¥${r.cpo.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`.padStart(13)
          : '    予約なし'.padStart(13);
        console.log(`${crPad} | ${resPad} | ${spendStr} | ${cpoStr}`);
      }
    }

    // 予約はあるが広告費が取得できないCR
    const noSpendWithReservation = results.filter(r => r.reservations > 0 && r.spend === 0);
    if (noSpendWithReservation.length > 0) {
      console.log('\n\n⚠️ 予約はあるが広告費が取得できないCR:');
      for (const r of noSpendWithReservation) {
        console.log(`  ${r.lpCr}: ${r.reservations}件の予約`);
      }
      console.log('  → 広告名のLP-CRパターンが登録経路と一致しない可能性があります');
    }

    // 広告費はあるが予約がないCRの上位表示
    const spendNoReservation = results.filter(r => r.reservations === 0 && r.spend > 0);
    if (spendNoReservation.length > 0) {
      console.log(`\n\n📊 広告費はあるが予約なしのCR: ${spendNoReservation.length}件`);
      const topSpend = spendNoReservation.sort((a, b) => b.spend - a.spend).slice(0, 10);
      for (const r of topSpend) {
        console.log(`  ${r.lpCr}: ¥${r.spend.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`);
      }
    }

    // 詳細情報：予約があるCRに紐づく広告一覧
    console.log('\n\n=== 詳細: 予約ありCRに紐づく広告一覧 ===');
    for (const r of results.filter(r => r.reservations > 0)) {
      const spendData = spendByLPCR.get(r.lpCr);
      console.log(`\n${r.lpCr} (予約: ${r.reservations}件, CPO: ${r.cpo !== null ? '¥' + r.cpo.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) : 'N/A'}):`);
      if (spendData) {
        for (const ad of spendData.ads) {
          console.log(`  - ${ad}`);
        }
      } else {
        console.log('  (該当広告なし)');
      }
    }

    // ========================================
    // CSV出力
    // ========================================
    const outputDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // --- Sheet 1: 予約ありCRのCPO（メイン） ---
    const reservedResults = results.filter(r => r.reservations > 0);
    const csvMainHeaders = ['LP-CR', 'CR番号', '予約数', '広告費', 'CPO', '広告数', '広告名'];
    const csvMainRows = reservedResults.map(r => {
      const spendData = spendByLPCR.get(r.lpCr);
      const adNames = spendData ? spendData.ads.map(a => a.replace(/\(¥\d+\)$/, '').trim()).join(' / ') : '';
      return [
        r.lpCr,
        r.cr,
        r.reservations,
        Math.round(r.spend),
        r.cpo !== null ? Math.round(r.cpo) : 'N/A',
        r.adCount,
        `"${adNames.replace(/"/g, '""')}"`,
      ].join(',');
    });

    // 予約ありCRの小計
    const reservedSpend = reservedResults.reduce((s, r) => s + r.spend, 0);
    const reservedCount = reservedResults.reduce((s, r) => s + r.reservations, 0);
    const reservedCPO = reservedCount > 0 ? Math.round(reservedSpend / reservedCount) : 'N/A';
    csvMainRows.push('');
    csvMainRows.push(`合計（予約ありCRのみ）,,${reservedCount},${Math.round(reservedSpend)},${reservedCPO},,`);
    csvMainRows.push(`合計（全CR）,,${totalReservations},${Math.round(totalSpend)},${overallCPO !== null ? Math.round(overallCPO) : 'N/A'},,`);

    // --- Sheet 2: 全CR一覧 ---
    const csvAllHeaders = ['LP-CR', 'CR番号', '予約数', '広告費', 'CPO', '広告数'];
    const csvAllRows = results.map(r => [
      r.lpCr,
      r.cr,
      r.reservations,
      Math.round(r.spend),
      r.cpo !== null ? Math.round(r.cpo) : (r.reservations > 0 ? '広告費なし' : '予約なし'),
      r.adCount,
    ].join(','));

    // --- Sheet 3: 予約者一覧 ---
    const csvReservationHeaders = ['メールアドレス', '登録経路', 'LP-CR', 'CR番号'];
    const csvReservationRows: string[] = [];
    for (const [regPath, data] of reservationCounts) {
      const lpCr = extractLPCRFromPath(regPath) || '';
      const cr = extractCRFromPath(regPath) || '';
      for (const email of data.emails) {
        csvReservationRows.push(`${email},"${regPath}",${lpCr},${cr}`);
      }
    }

    // BOM付きUTF-8で結合出力
    const bom = '\uFEFF';
    const csvContent = [
      '=== AI導線 CRごとの個別予約CPO ===',
      `対象期間: ${START_DATE} 〜 ${END_DATE}`,
      '',
      '--- 予約ありCRのCPO（CPO良い順） ---',
      csvMainHeaders.join(','),
      ...csvMainRows,
      '',
      '',
      '--- 全CR一覧（CPO良い順 → 広告費高い順） ---',
      csvAllHeaders.join(','),
      ...csvAllRows,
      '',
      '',
      '--- 予約者一覧 ---',
      csvReservationHeaders.join(','),
      ...csvReservationRows,
    ].join('\n');

    const outputPath = path.join(outputDir, `AI導線_CRごとの個別予約CPO_${START_DATE}_${END_DATE}.csv`);
    fs.writeFileSync(outputPath, bom + csvContent, 'utf-8');
    console.log(`\n\nCSVファイル出力完了: ${outputPath}`);

  } catch (error) {
    console.error('エラー:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
