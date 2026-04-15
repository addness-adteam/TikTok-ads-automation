/**
 * スキルプラス導線の配信中広告 - 個別予約CPOチェック
 * npx tsx apps/backend/check-sp-indres-cpo.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const INDIVIDUAL_RESERVATION_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

const ALLOWABLE_IND_RES_CPO = 48830; // スキルプラスのKPI

const SP_ACCOUNTS = [
  { id: '7474920444831875080', name: 'SP1' },
  { id: '7592868952431362066', name: 'SP2' },
  { id: '7616545514662051858', name: 'SP3' },
];

function jstDateStr(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
}

function extractLPCR(adName: string): string | null {
  const m = adName.match(/(LP\d+-CR\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

async function tiktokGet(endpoint: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const now = new Date();
  const endDate = jstDateStr(now);
  const startDate = jstDateStr(new Date(now.getTime() - 7 * 86400000));

  // 1. 個別予約シートから7日間の予約数を取得（スキルプラス）
  console.log('=== 個別予約シート読み込み（スキルプラス） ===');
  const indResMap = new Map<string, number>();
  {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: INDIVIDUAL_RESERVATION_SHEET_ID,
      range: `スキルプラス（オートウェビナー用）!A:AZ`,
    });
    const rows: any[][] = res.data.values || [];
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const rangeEnd = new Date(`${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(jstNow.getUTCDate()).padStart(2, '0')}T23:59:59+09:00`);
    const rangeStart = new Date(rangeEnd.getTime() - 7 * 86400000);

    let total = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const dateStr = String(row[0] || '').trim();
      const pathValue = row[34]; // スキルプラスの個別予約CR列
      if (!dateStr || !pathValue) continue;

      const m = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (!m) continue;
      const rowDate = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), -9, 0, 0));
      if (rowDate < rangeStart || rowDate > rangeEnd) continue;

      const lines = String(pathValue).split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const lpCrMatch = trimmed.match(/(LP\d+-CR\d+)/i);
        if (lpCrMatch) {
          const lpCr = lpCrMatch[1].toUpperCase();
          indResMap.set(lpCr, (indResMap.get(lpCr) || 0) + 1);
          total++;
        }
      }
    }
    console.log(`7日間の個別予約: ${total}件（${indResMap.size}種類のLP-CR）`);
    for (const [lpCr, count] of [...indResMap.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${lpCr}: ${count}件`);
    }
  }

  // 2. SP各アカウントの配信中広告 + 7日広告費を取得
  console.log('\n=== 配信中広告 + 広告費取得 ===');

  interface AdInfo {
    adId: string;
    adName: string;
    lpCr: string | null;
    accountName: string;
    spend7d: number;
    campaignName?: string;
  }

  const allAds: AdInfo[] = [];

  for (const account of SP_ACCOUNTS) {
    // 配信中広告取得
    let ads: any[] = [];
    let page = 1;
    while (true) {
      const resp = await tiktokGet('/v1.3/ad/get/', {
        advertiser_id: account.id,
        filtering: JSON.stringify({ status: 'AD_STATUS_DELIVERY_OK' }),
        fields: JSON.stringify(['ad_id', 'ad_name', 'campaign_id']),
        page_size: '100',
        page: String(page),
      });
      if (resp.code !== 0) { console.error(`  ${account.name}: エラー ${resp.message}`); break; }
      const list = resp.data?.list || [];
      ads.push(...list);
      if (list.length < 100) break;
      page++;
    }

    console.log(`${account.name}: ${ads.length}件の配信中広告`);
    if (ads.length === 0) continue;

    // キャンペーン名取得
    const campaignIds = [...new Set(ads.map((a: any) => a.campaign_id).filter(Boolean))];
    const campaignNameMap = new Map<string, string>();
    if (campaignIds.length > 0) {
      for (let i = 0; i < campaignIds.length; i += 100) {
        const batch = campaignIds.slice(i, i + 100);
        const cResp = await tiktokGet('/v1.3/campaign/get/', {
          advertiser_id: account.id,
          filtering: JSON.stringify({ campaign_ids: batch }),
          fields: JSON.stringify(['campaign_id', 'campaign_name']),
          page_size: '100',
        });
        if (cResp.code === 0 && cResp.data?.list) {
          for (const c of cResp.data.list) {
            campaignNameMap.set(c.campaign_id, c.campaign_name);
          }
        }
      }
    }

    // 広告費取得
    const adIds = ads.map((a: any) => a.ad_id);
    const spendMap = new Map<string, number>();
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
          spendMap.set(row.dimensions?.ad_id, parseFloat(row.metrics?.spend || '0'));
        }
      }
    }

    for (const ad of ads) {
      const adName = ad.ad_name || '';
      const campName = campaignNameMap.get(ad.campaign_id) || '';
      // LP-CRは広告名 → キャンペーン名の順で探す（Smart+は広告名にLP-CRがない）
      const lpCr = extractLPCR(adName) || extractLPCR(campName);
      allAds.push({
        adId: ad.ad_id,
        adName,
        lpCr,
        accountName: account.name,
        spend7d: spendMap.get(ad.ad_id) || 0,
        campaignName: campName,
      });
    }
  }

  // 3. LP-CRでグルーピングしてCPO算出
  // LP-CR形式の広告とそうでない広告（Smart+素材）を分離
  const withLpCr = allAds.filter(a => a.lpCr);
  const withoutLpCr = allAds.filter(a => !a.lpCr && a.spend7d > 0);

  // LP-CRごとに集約（同じLP-CRが複数アカウントにある場合はアカウント単位で分ける）
  const grouped = new Map<string, { ads: AdInfo[]; totalSpend: number; indRes: number }>();
  for (const ad of withLpCr) {
    const key = `${ad.accountName}:${ad.lpCr}`;
    if (!grouped.has(key)) {
      grouped.set(key, { ads: [], totalSpend: 0, indRes: indResMap.get(ad.lpCr!) || 0 });
    }
    const g = grouped.get(key)!;
    g.ads.push(ad);
    g.totalSpend += ad.spend7d;
  }

  // 4. 結果表示
  console.log('\n========================================================');
  console.log('スキルプラス導線 配信中広告 個別予約CPOレポート');
  console.log(`期間: ${startDate} 〜 ${endDate}（7日間）`);
  console.log(`許容個別予約CPO: ¥${ALLOWABLE_IND_RES_CPO.toLocaleString()}`);
  console.log('========================================================\n');

  // 広告費順でソート
  const sorted = [...grouped.entries()]
    .filter(([_, g]) => g.totalSpend > 0)
    .sort((a, b) => b[1].totalSpend - a[1].totalSpend);

  const noSpend = [...grouped.entries()].filter(([_, g]) => g.totalSpend === 0);

  let failCount = 0;
  let passCount = 0;
  let noResCount = 0;

  for (const [key, g] of sorted) {
    const ad = g.ads[0];
    const cpo = g.indRes > 0 ? g.totalSpend / g.indRes : null;
    let status = '';
    if (g.indRes === 0) {
      if (g.totalSpend >= ALLOWABLE_IND_RES_CPO) {
        status = '🔴 予約0件・許容超過消化';
        failCount++;
      } else {
        status = '⚠️ 予約0件';
        noResCount++;
      }
    } else if (cpo! > ALLOWABLE_IND_RES_CPO) {
      status = `❌ KPI未達 (${(cpo! / ALLOWABLE_IND_RES_CPO * 100).toFixed(0)}%)`;
      failCount++;
    } else {
      status = `✅ KPI達成 (${(cpo! / ALLOWABLE_IND_RES_CPO * 100).toFixed(0)}%)`;
      passCount++;
    }

    console.log(`${status}`);
    console.log(`  【${ad.accountName}】${ad.lpCr}`);
    console.log(`  広告名: ${ad.adName}`);
    if (ad.campaignName) console.log(`  キャンペーン: ${ad.campaignName}`);
    console.log(`  7日広告費: ¥${Math.round(g.totalSpend).toLocaleString()}`);
    console.log(`  7日個別予約: ${g.indRes}件${cpo !== null ? ` → CPO ¥${Math.round(cpo).toLocaleString()}` : ''}`);
    if (g.ads.length > 1) {
      console.log(`  （${g.ads.length}件の広告を合算）`);
    }
    console.log('');
  }

  // Smart+素材（LP-CRなし）で広告費があるもの
  if (withoutLpCr.length > 0) {
    console.log('--- Smart+素材（LP-CR形式外） ---');
    for (const ad of withoutLpCr.sort((a, b) => b.spend7d - a.spend7d)) {
      console.log(`  【${ad.accountName}】¥${Math.round(ad.spend7d).toLocaleString()} - ${ad.adName}`);
      if (ad.campaignName) console.log(`    キャンペーン: ${ad.campaignName}`);
    }
    console.log('');
  }

  // 広告費0の広告（参考）
  if (noSpend.length > 0) {
    console.log(`--- 広告費¥0（${noSpend.length}件、省略） ---\n`);
  }

  console.log('=== 集計 ===');
  console.log(`KPI未達 / 許容超過: ${failCount}件`);
  console.log(`KPI達成: ${passCount}件`);
  console.log(`予約0件（消化少）: ${noResCount}件`);
  console.log(`Smart+素材: ${withoutLpCr.length}件`);
  console.log(`広告費¥0: ${noSpend.length}件`);
}

main().catch(console.error);
