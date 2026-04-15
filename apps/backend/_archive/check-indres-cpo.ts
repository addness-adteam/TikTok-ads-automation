/**
 * 配信中広告の個別予約CPO KPI未達チェック
 * - TikTok APIから配信中広告 + 7日間広告費を取得
 * - 個別予約シートから7日間の個別予約数を取得
 * - CPO = 7日広告費 ÷ 7日個別予約数 で算出してKPIと比較
 *
 * npx tsx apps/backend/check-indres-cpo.ts
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

function extractLPCR(adName: string): string | null {
  const m = adName.match(/(LP\d+-CR\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

// JST日付文字列 YYYY-MM-DD
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

interface ActiveAd {
  adId: string;
  adName: string;
  lpCr: string;
  accountName: string;
  appeal: string;
  spend7d: number;
}

async function getActiveAdsWithSpend(account: { id: string; name: string; appeal: string }): Promise<ActiveAd[]> {
  const now = new Date();
  const endDate = jstDateStr(now);
  const startDate = jstDateStr(new Date(now.getTime() - 7 * 86400000));

  // 配信中の広告を取得（ページネーション対応）
  let allAds: any[] = [];
  let page = 1;
  while (true) {
    const adsResp = await tiktokGet('/v1.3/ad/get/', {
      advertiser_id: account.id,
      filtering: JSON.stringify({ status: 'AD_STATUS_DELIVERY_OK' }),
      fields: JSON.stringify(['ad_id', 'ad_name', 'ad_text']),
      page_size: '100',
      page: String(page),
    });
    if (adsResp.code !== 0) {
      console.error(`  ⚠️ 広告取得エラー (${account.name}): ${adsResp.message}`);
      break;
    }
    const list = adsResp.data?.list || [];
    allAds.push(...list);
    if (list.length < 100) break;
    page++;
  }

  if (allAds.length === 0) return [];

  // 広告費を取得（レポートAPI）
  const adIds = allAds.map((a: any) => a.ad_id);
  const spendMap = new Map<string, number>();

  // 100件ずつバッチ
  for (let i = 0; i < adIds.length; i += 100) {
    const batch = adIds.slice(i, i + 100);
    const reportResp = await tiktokGet('/v1.3/report/integrated/get/', {
      advertiser_id: account.id,
      report_type: 'BASIC',
      data_level: 'AUCTION_AD',
      dimensions: JSON.stringify(['ad_id']),
      metrics: JSON.stringify(['spend']),
      start_date: startDate,
      end_date: endDate,
      filtering: JSON.stringify([{ field_name: 'ad_ids', filter_type: 'IN', filter_value: JSON.stringify(batch) }]),
      page_size: '100',
    });
    if (reportResp.code === 0 && reportResp.data?.list) {
      for (const row of reportResp.data.list) {
        const adId = row.dimensions?.ad_id;
        const spend = parseFloat(row.metrics?.spend || '0');
        if (adId) spendMap.set(adId, spend);
      }
    }
  }

  const results: ActiveAd[] = [];
  for (const ad of allAds) {
    const adName = ad.ad_name || '';
    const lpCr = extractLPCR(adName);
    if (!lpCr) continue; // LP-CRフォーマットでない広告はスキップ（Smart+素材など）

    results.push({
      adId: ad.ad_id,
      adName,
      lpCr,
      accountName: account.name,
      appeal: account.appeal,
      spend7d: spendMap.get(ad.ad_id) || 0,
    });
  }

  return results;
}

async function getIndividualReservations7d(sheets: any): Promise<Map<string, number>> {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const endDate = new Date(`${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(jstNow.getUTCDate()).padStart(2, '0')}T23:59:59+09:00`);
  const startDate = new Date(endDate.getTime() - 7 * 86400000);

  const result = new Map<string, number>();

  for (const [appeal, config] of Object.entries(RESERVATION_SHEET_CONFIG)) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: INDIVIDUAL_RESERVATION_SHEET_ID,
        range: `${config.sheetName}!A:AZ`,
      });
      const rows: any[][] = res.data.values || [];
      if (rows.length < 2) continue;

      let count = 0;
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
            result.set(lpCr, (result.get(lpCr) || 0) + 1);
            count++;
          }
        }
      }
      console.log(`  ${appeal}シート: ${count}件の個別予約（7日間）`);
    } catch (e: any) {
      console.error(`  ${appeal}シート読み取りエラー:`, e.message);
    }
  }

  return result;
}

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. 個別予約シートから7日間の予約数を取得
  console.log('=== 個別予約シート読み込み ===');
  const indResMap = await getIndividualReservations7d(sheets);
  console.log(`\n合計LP-CR: ${indResMap.size}種類\n`);

  // 2. 全アカウントから配信中広告 + 7日広告費を取得
  console.log('=== 配信中広告 + 広告費取得 ===');
  const allAds: ActiveAd[] = [];
  for (const account of ACCOUNTS) {
    const ads = await getActiveAdsWithSpend(account);
    console.log(`  ${account.name}: ${ads.length}件（LP-CR形式のみ）`);
    allAds.push(...ads);
  }
  console.log(`\n合計配信中広告: ${allAds.length}件\n`);

  // 3. LP-CRでマッチしてCPO算出
  // 同じLP-CRが複数アカウントにある場合は合算（横展開）
  // → アカウント単位で見るべきなので、アカウント+LP-CRでグルーピング
  const grouped = new Map<string, { ads: ActiveAd[]; totalSpend: number; indRes: number }>();

  for (const ad of allAds) {
    const key = `${ad.accountName}:${ad.lpCr}`;
    if (!grouped.has(key)) {
      grouped.set(key, { ads: [], totalSpend: 0, indRes: indResMap.get(ad.lpCr) || 0 });
    }
    const g = grouped.get(key)!;
    g.ads.push(ad);
    g.totalSpend += ad.spend7d;
  }

  // 4. KPI判定
  interface Result {
    accountName: string;
    appeal: string;
    lpCr: string;
    adNames: string[];
    spend7d: number;
    indRes: number;
    cpo: number | null;
    allowableCPO: number;
    status: 'FAIL' | 'PASS' | 'NO_RES';
  }

  const results: Result[] = [];
  for (const [key, g] of grouped) {
    const ad = g.ads[0];
    const allowableCPO = KPI[ad.appeal] || 0;
    const cpo = g.indRes > 0 ? g.totalSpend / g.indRes : null;
    const status = g.indRes === 0 ? 'NO_RES' : (cpo! > allowableCPO ? 'FAIL' : 'PASS');

    results.push({
      accountName: ad.accountName,
      appeal: ad.appeal,
      lpCr: ad.lpCr,
      adNames: g.ads.map(a => a.adName),
      spend7d: g.totalSpend,
      indRes: g.indRes,
      cpo,
      allowableCPO,
      status,
    });
  }

  // 5. 結果表示
  const failed = results.filter(r => r.status === 'FAIL').sort((a, b) => (b.cpo || 0) - (a.cpo || 0));
  const noRes = results.filter(r => r.status === 'NO_RES' && r.spend7d > 0).sort((a, b) => b.spend7d - a.spend7d);
  const noResOverBudget = noRes.filter(r => r.spend7d >= r.allowableCPO);
  const passed = results.filter(r => r.status === 'PASS').sort((a, b) => (a.cpo || 0) - (b.cpo || 0));

  console.log('========================================');
  console.log('❌ 個別予約CPO KPI未達（配信中）');
  console.log('========================================\n');

  if (failed.length === 0) {
    console.log('なし\n');
  } else {
    for (const r of failed) {
      const ratio = (r.cpo! / r.allowableCPO * 100).toFixed(0);
      console.log(`【${r.accountName}】${r.appeal} / ${r.lpCr}`);
      console.log(`  広告名: ${r.adNames[0]}`);
      console.log(`  7日個別予約CPO: ¥${Math.round(r.cpo!).toLocaleString()} (KPI: ¥${r.allowableCPO.toLocaleString()}, ${ratio}%)`);
      console.log(`  7日個別予約数: ${r.indRes}件 / 7日広告費: ¥${Math.round(r.spend7d).toLocaleString()}`);
      console.log('');
    }
  }

  console.log('========================================');
  console.log('🔴 個別予約0件 かつ 許容CPO超過消化');
  console.log('========================================\n');

  if (noResOverBudget.length === 0) {
    console.log('なし\n');
  } else {
    for (const r of noResOverBudget) {
      console.log(`【${r.accountName}】${r.appeal} / ${r.lpCr}`);
      console.log(`  広告名: ${r.adNames[0]}`);
      console.log(`  7日広告費: ¥${Math.round(r.spend7d).toLocaleString()} (許容CPO: ¥${r.allowableCPO.toLocaleString()})`);
      console.log('');
    }
  }

  console.log('========================================');
  console.log('✅ KPI達成中');
  console.log('========================================\n');

  if (passed.length === 0) {
    console.log('なし\n');
  } else {
    for (const r of passed) {
      const ratio = (r.cpo! / r.allowableCPO * 100).toFixed(0);
      console.log(`【${r.accountName}】${r.lpCr} → CPO ¥${Math.round(r.cpo!).toLocaleString()} (${ratio}% of KPI) 予約${r.indRes}件`);
      console.log(`  ${r.adNames[0]}`);
    }
  }

  console.log('\n--- 集計 ---');
  console.log(`KPI未達: ${failed.length}件`);
  console.log(`予約0件+許容超過消化: ${noResOverBudget.length}件`);
  console.log(`KPI達成: ${passed.length}件`);
  console.log(`予約0件（消化少）: ${noRes.length - noResOverBudget.length}件`);
}

main().catch(console.error);
