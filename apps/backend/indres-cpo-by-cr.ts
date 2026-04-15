/**
 * 個別予約したCR起点の個別予約CPO算出
 * - スプシから直近7日間で個別予約があったCRを取得
 * - TikTok APIで全アカウントの全広告（配信状態問わず）を取得しLP-CRマッチ
 * - レポートAPIで7日間広告費を取得
 * - CPO = 7日広告費 ÷ 7日個別予約数
 *
 * npx tsx apps/backend/indres-cpo-by-cr.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const INDIVIDUAL_RESERVATION_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

const KPI: Record<string, number> = {
  'AI': 53795,
  'SNS': 37753,
  'スキルプラス': 48830,
};

const ACCOUNTS = [
  { id: '7468288053866561553', name: 'AI_1', appeal: 'AI' },
  { id: '7523128243466551303', name: 'AI_2', appeal: 'AI' },
  { id: '7543540647266074641', name: 'AI_3', appeal: 'AI' },
  { id: '7580666710525493255', name: 'AI_4', appeal: 'AI' },
  { id: '7247073333517238273', name: 'SNS1', appeal: 'SNS' },
  { id: '7543540100849156112', name: 'SNS2', appeal: 'SNS' },
  { id: '7543540381615800337', name: 'SNS3', appeal: 'SNS' },
  { id: '7474920444831875080', name: 'SP1', appeal: 'スキルプラス' },
  { id: '7592868952431362066', name: 'SP2', appeal: 'スキルプラス' },
  { id: '7616545514662051858', name: 'SP3', appeal: 'スキルプラス' },
];

const RESERVATION_SHEET_CONFIG: Record<string, { sheetName: string; dateCol: number; pathCol: number }> = {
  'AI': { sheetName: 'AI', dateCol: 0, pathCol: 46 },
  'SNS': { sheetName: 'SNS', dateCol: 0, pathCol: 46 },
  'スキルプラス': { sheetName: 'スキルプラス（オートウェビナー用）', dateCol: 0, pathCol: 34 },
};

/** 広告名からLP-CRを抽出。サフィックス（_横展開ID）があっても最初のLP-CRを取る */
function extractLPCR(adName: string): string | null {
  const m = adName.match(/(LP\d+-CR\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

function jstDateStr(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
}

async function tiktokGet(endpoint: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

/** スプシから直近7日間の個別予約を LP-CR + 導線 でカウント */
async function getReservations7d(sheets: any): Promise<Map<string, { count: number; appeal: string }>> {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const endDate = new Date(`${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(jstNow.getUTCDate()).padStart(2, '0')}T23:59:59+09:00`);
  const startDate = new Date(endDate.getTime() - 7 * 86400000);

  const result = new Map<string, { count: number; appeal: string }>();

  for (const [appeal, config] of Object.entries(RESERVATION_SHEET_CONFIG)) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: INDIVIDUAL_RESERVATION_SHEET_ID,
        range: `${config.sheetName}!A:AZ`,
      });
      const rows: any[][] = res.data.values || [];
      if (rows.length < 2) continue;

      let sheetCount = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const dateStr = String(row[config.dateCol] || '').trim();
        const pathValue = row[config.pathCol];
        if (!dateStr || !pathValue) continue;

        const m = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
        if (!m) continue;
        const rowDate = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), -9, 0, 0));
        if (rowDate < startDate || rowDate > endDate) continue;

        const lines = String(pathValue).split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const lpCrMatch = trimmed.match(/(LP\d+-CR\d+)/i);
          if (lpCrMatch) {
            const lpCr = lpCrMatch[1].toUpperCase();
            const existing = result.get(lpCr);
            if (existing) {
              existing.count++;
            } else {
              result.set(lpCr, { count: 1, appeal });
            }
            sheetCount++;
          }
        }
      }
      console.log(`  ${appeal}シート: ${sheetCount}件の個別予約（7日間）`);
    } catch (e: any) {
      console.error(`  ${appeal}シート読み取りエラー:`, e.message);
    }
  }

  return result;
}

/** TikTok APIで全広告を取得（配信状態問わず）してLP-CRでグルーピング */
async function getAllAdsMapping(targetLpCrs: Set<string>): Promise<Map<string, { adIds: string[]; accountId: string; accountName: string; appeal: string; adName: string }>> {
  const result = new Map<string, { adIds: string[]; accountId: string; accountName: string; appeal: string; adName: string }>();

  for (const account of ACCOUNTS) {
    let page = 1;
    let totalFound = 0;
    while (true) {
      const resp = await tiktokGet('/v1.3/ad/get/', {
        advertiser_id: account.id,
        fields: JSON.stringify(['ad_id', 'ad_name']),
        page_size: '100',
        page: String(page),
      });
      if (resp.code !== 0) {
        console.error(`  ⚠️ 広告取得エラー (${account.name}): ${resp.message}`);
        break;
      }
      const list = resp.data?.list || [];
      for (const ad of list) {
        const lpCr = extractLPCR(ad.ad_name || '');
        if (!lpCr || !targetLpCrs.has(lpCr)) continue;

        const key = `${account.name}:${lpCr}`;
        const existing = result.get(key);
        if (existing) {
          existing.adIds.push(ad.ad_id);
        } else {
          result.set(key, {
            adIds: [ad.ad_id],
            accountId: account.id,
            accountName: account.name,
            appeal: account.appeal,
            adName: ad.ad_name,
          });
        }
        totalFound++;
      }
      if (list.length < 100) break;
      page++;
    }
    if (totalFound > 0) {
      console.log(`  ${account.name}: ${totalFound}件マッチ`);
    }
  }

  return result;
}

/** 広告IDリストの7日間広告費を取得 */
async function getSpend7d(accountId: string, adIds: string[]): Promise<number> {
  const now = new Date();
  const endDate = jstDateStr(now);
  const startDate = jstDateStr(new Date(now.getTime() - 7 * 86400000));

  let totalSpend = 0;
  for (let i = 0; i < adIds.length; i += 100) {
    const batch = adIds.slice(i, i + 100);
    const resp = await tiktokGet('/v1.3/report/integrated/get/', {
      advertiser_id: accountId,
      report_type: 'BASIC',
      data_level: 'AUCTION_AD',
      dimensions: JSON.stringify(['ad_id']),
      metrics: JSON.stringify(['spend']),
      start_date: startDate,
      end_date: endDate,
      filtering: JSON.stringify([{ field_name: 'ad_ids', filter_type: 'IN', filter_value: JSON.stringify(batch) }]),
      page_size: '1000',
    });
    if (resp.code === 0 && resp.data?.list) {
      for (const row of resp.data.list) {
        totalSpend += parseFloat(row.metrics?.spend || '0');
      }
    }
  }
  return totalSpend;
}

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. 個別予約シートから7日間で予約があったCRを取得
  console.log('=== ① 個別予約シート読み込み（直近7日間） ===');
  const reservationMap = await getReservations7d(sheets);
  console.log(`\n個別予約があったCR: ${reservationMap.size}種類\n`);

  if (reservationMap.size === 0) {
    console.log('直近7日間に個別予約はありません。');
    return;
  }

  for (const [lpCr, data] of reservationMap) {
    console.log(`  ${lpCr} (${data.appeal}): ${data.count}件`);
  }

  // 2. TikTok APIで全広告取得→LP-CRマッチ（配信状態問わず）
  console.log('\n=== ② TikTok APIから対象CRの広告を検索（全状態） ===');
  const targetLpCrs = new Set(reservationMap.keys());
  const adsMapping = await getAllAdsMapping(targetLpCrs);

  // 見つからなかったCR
  const foundLpCrs = new Set<string>();
  for (const key of adsMapping.keys()) {
    const lpCr = key.split(':').pop()!;
    foundLpCrs.add(lpCr);
  }
  const missingLpCrs = [...targetLpCrs].filter(lc => !foundLpCrs.has(lc));
  if (missingLpCrs.length > 0) {
    console.log(`\n  ⚠️ 広告が見つからないCR: ${missingLpCrs.join(', ')}`);
  }

  // 3. 各CRの7日間広告費を取得してCPO算出
  console.log('\n=== ③ 個別予約CPO算出 ===\n');

  interface CRResult {
    lpCr: string;
    appeal: string;
    indRes: number;
    totalSpend: number;
    cpo: number;
    accounts: string[];
    adName: string;
    adCount: number;
  }

  const results: CRResult[] = [];

  for (const [lpCr, resData] of reservationMap) {
    let totalSpend = 0;
    const accounts: string[] = [];
    let adName = '';
    let adCount = 0;

    for (const [key, adData] of adsMapping) {
      if (!key.endsWith(`:${lpCr}`)) continue;
      const spend = await getSpend7d(adData.accountId, adData.adIds);
      totalSpend += spend;
      accounts.push(`${adData.accountName}(${adData.adIds.length}広告, ¥${Math.round(spend).toLocaleString()})`);
      if (!adName) adName = adData.adName;
      adCount += adData.adIds.length;
    }

    const cpo = resData.count > 0 ? totalSpend / resData.count : 0;
    results.push({
      lpCr,
      appeal: resData.appeal,
      indRes: resData.count,
      totalSpend,
      cpo,
      accounts,
      adName,
      adCount,
    });
  }

  // CPO降順でソート
  results.sort((a, b) => b.cpo - a.cpo);

  // 結果表示
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│  直近7日間 個別予約したCRの個別予約CPO                      │');
  console.log('└─────────────────────────────────────────────────────────────┘\n');

  let totalSpendAll = 0;
  let totalResAll = 0;

  for (const r of results) {
    const kpi = KPI[r.appeal] || 0;
    const kpiStatus = kpi > 0 ? (r.cpo <= kpi ? '✅' : '❌') : '';
    const kpiPct = kpi > 0 ? ` (KPI比${(r.cpo / kpi * 100).toFixed(0)}%)` : '';

    console.log(`${kpiStatus} ${r.lpCr} [${r.appeal}]`);
    console.log(`  個別予約CPO: ¥${Math.round(r.cpo).toLocaleString()}${kpiPct}`);
    console.log(`  個別予約数: ${r.indRes}件 / 7日広告費: ¥${Math.round(r.totalSpend).toLocaleString()} (${r.adCount}広告)`);
    if (r.accounts.length > 0) {
      console.log(`  アカウント: ${r.accounts.join(', ')}`);
    }
    if (r.adName) {
      console.log(`  広告名例: ${r.adName}`);
    }
    console.log('');

    totalSpendAll += r.totalSpend;
    totalResAll += r.indRes;
  }

  console.log('--- 全体集計 ---');
  console.log(`個別予約があったCR: ${results.length}種類`);
  console.log(`個別予約合計: ${totalResAll}件`);
  console.log(`広告費合計: ¥${Math.round(totalSpendAll).toLocaleString()}`);
  if (totalResAll > 0) {
    console.log(`全体平均CPO: ¥${Math.round(totalSpendAll / totalResAll).toLocaleString()}`);
  }

  const kpiPass = results.filter(r => {
    const kpi = KPI[r.appeal] || 0;
    return kpi > 0 && r.cpo <= kpi;
  });
  const kpiFail = results.filter(r => {
    const kpi = KPI[r.appeal] || 0;
    return kpi > 0 && r.cpo > kpi;
  });
  console.log(`KPI達成: ${kpiPass.length}件 / KPI未達: ${kpiFail.length}件`);
}

main().catch(console.error);
