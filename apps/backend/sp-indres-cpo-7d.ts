/**
 * スキルプラス導線: 過去7日間に個別予約があったCRの個別予約CPO
 * npx tsx apps/backend/sp-indres-cpo-7d.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const INDRES_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';
const ALLOWABLE_CPO = 48830;

const SP_ACCOUNTS = [
  { id: '7474920444831875080', name: 'SP1' },
  { id: '7592868952431362066', name: 'SP2' },
  { id: '7616545514662051858', name: 'SP3' },
];

function jstDate(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')}`;
}
function addDays(s: string, n: number): string {
  const d = new Date(s); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function tiktokGet(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

function extractLpCr(s: string): string | null {
  const m = s.match(/(LP\d+-CR\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const now = new Date();
  const endDate = jstDate(now);
  const startDate = jstDate(new Date(now.getTime() - 7 * 86400000));

  console.log(`=== スキルプラス 過去7日 個別予約CPO ===`);
  console.log(`期間: ${startDate} 〜 ${endDate}`);
  console.log(`許容CPO: ¥${ALLOWABLE_CPO.toLocaleString()}\n`);

  // 1. 個別予約シートから7日間の予約を取得
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: INDRES_SHEET_ID,
    range: 'スキルプラス（オートウェビナー用）!A:AZ',
  });
  const rows: any[][] = res.data.values || [];

  const jstNow = new Date(Date.now() + 9 * 3600000);
  const rangeEnd = new Date(`${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(jstNow.getUTCDate()).padStart(2, '0')}T23:59:59+09:00`);
  const rangeStart = new Date(rangeEnd.getTime() - 7 * 86400000);

  const indResByCr = new Map<string, { count: number; dates: string[] }>();
  for (let i = 1; i < rows.length; i++) {
    const dateStr = String(rows[i]?.[0] || '').trim();
    const pathCell = String(rows[i]?.[34] || ''); // AI列(34)
    if (!dateStr || !pathCell) continue;

    const m = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (!m) continue;
    const rowDate = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), -9));
    if (rowDate < rangeStart || rowDate > rangeEnd) continue;

    for (const line of pathCell.split('\n')) {
      const cr = extractLpCr(line.trim());
      if (!cr) continue;
      if (!indResByCr.has(cr)) indResByCr.set(cr, { count: 0, dates: [] });
      indResByCr.get(cr)!.count++;
      indResByCr.get(cr)!.dates.push(dateStr);
    }
  }

  if (indResByCr.size === 0) {
    console.log('過去7日間に個別予約がありません');
    return;
  }

  console.log(`個別予約があったCR: ${indResByCr.size}件\n`);

  // 2. 全アカウントのキャンペーン名からLP-CRを収集し、広告費を取得
  const crSpend = new Map<string, { spend: number; accounts: Set<string>; campNames: string[] }>();

  for (const acc of SP_ACCOUNTS) {
    // 全キャンペーン名取得
    const campMap = new Map<string, string>(); // campId -> campName
    let page = 1;
    while (true) {
      const resp = await tiktokGet('/v1.3/campaign/get/', {
        advertiser_id: acc.id, page_size: '100', page: String(page),
        fields: JSON.stringify(['campaign_id', 'campaign_name']),
      });
      if (resp.code !== 0) break;
      for (const c of resp.data?.list || []) campMap.set(c.campaign_id, c.campaign_name || '');
      if ((resp.data?.list || []).length < 100) break;
      page++;
    }

    // 対象CRのキャンペーンIDを特定
    const targetCampIds: string[] = [];
    const campCrMap = new Map<string, string>(); // campId -> lpCr
    for (const [campId, campName] of campMap) {
      const cr = extractLpCr(campName);
      if (cr && indResByCr.has(cr)) {
        targetCampIds.push(campId);
        campCrMap.set(campId, cr);
      }
    }

    if (targetCampIds.length === 0) continue;

    // キャンペーンレベルの広告費取得（30日制限対応）
    const periods = [{ start: startDate, end: endDate }];
    for (const period of periods) {
      for (let i = 0; i < targetCampIds.length; i += 100) {
        const batch = targetCampIds.slice(i, i + 100);
        const resp = await tiktokGet('/v1.3/report/integrated/get/', {
          advertiser_id: acc.id, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
          dimensions: JSON.stringify(['campaign_id']),
          metrics: JSON.stringify(['spend', 'conversion']),
          start_date: period.start, end_date: period.end,
          filtering: JSON.stringify([{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify(batch) }]),
          page_size: '100',
        });
        if (resp.code !== 0) continue;
        for (const row of resp.data?.list || []) {
          const campId = row.dimensions?.campaign_id;
          const cr = campCrMap.get(campId);
          if (!cr) continue;
          const spend = parseFloat(row.metrics?.spend || '0');
          if (!crSpend.has(cr)) crSpend.set(cr, { spend: 0, accounts: new Set(), campNames: [] });
          const entry = crSpend.get(cr)!;
          entry.spend += spend;
          entry.accounts.add(acc.name);
          const campName = campMap.get(campId) || '';
          if (!entry.campNames.includes(campName)) entry.campNames.push(campName);
        }
      }
    }
  }

  // 3. 結果表示
  console.log('LP-CR          | 個別予約 | 7日費用        | CPO            | 判定');
  console.log('---------------|---------|---------------|---------------|--------');

  const results = [...indResByCr.entries()]
    .map(([cr, data]) => {
      const spend = crSpend.get(cr)?.spend || 0;
      const cpo = data.count > 0 && spend > 0 ? spend / data.count : null;
      const accounts = crSpend.get(cr)?.accounts || new Set();
      const campNames = crSpend.get(cr)?.campNames || [];
      return { cr, indRes: data.count, dates: data.dates, spend, cpo, accounts: [...accounts], campNames };
    })
    .sort((a, b) => {
      if (a.cpo === null && b.cpo === null) return b.indRes - a.indRes;
      if (a.cpo === null) return 1;
      if (b.cpo === null) return -1;
      return a.cpo - b.cpo;
    });

  let passCount = 0, failCount = 0;

  for (const r of results) {
    let verdict = '';
    if (r.cpo === null) {
      verdict = r.spend === 0 ? '費用データなし' : '予約0件';
    } else if (r.cpo <= ALLOWABLE_CPO) {
      verdict = 'OK';
      passCount++;
    } else if (r.cpo <= ALLOWABLE_CPO * 2) {
      verdict = 'KPI超過';
      failCount++;
    } else {
      verdict = '撤退';
      failCount++;
    }

    const cpoStr = r.cpo !== null ? `¥${Math.round(r.cpo).toLocaleString()}` : '-';
    console.log(`${r.cr.padEnd(15)}| ${String(r.indRes).padStart(4)}件  | ¥${Math.round(r.spend).toLocaleString().padStart(12)} | ${cpoStr.padStart(13)} | ${verdict}`);
    for (const cn of r.campNames) {
      console.log(`  ${r.accounts.join(',')} | ${cn}`);
    }
  }

  console.log(`\n合計: KPI達成 ${passCount}件 / KPI超過・撤退 ${failCount}件 / データなし ${results.filter(r => r.cpo === null).length}件`);
}

main().catch(console.error);
