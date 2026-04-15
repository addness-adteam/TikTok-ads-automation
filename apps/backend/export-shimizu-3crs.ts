import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.join(__dirname, '.env') });

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheetsApi = google.sheets({ version: 'v4', auth });

const TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const API_BASE = 'https://business-api.tiktok.com/open_api';

// スキルプラス導線
const CV_SHEET_ID = '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk';
const FRONT_SHEET_ID = ''; // SP導線はフロントシート別（セミナー着座）なので空
const ADV_ID = '7474920444831875080'; // SP1

const ADS = [
  { cr: 'CR00609', adId: '1862063730305106', lp: 'LP2', label: 'CR00609_穏やか3万小遣い' },
  { cr: 'CR00616', adId: '1862150280283378', lp: 'LP2', label: 'CR00616' },
  { cr: 'CR00617', adId: '1862150389794849', lp: 'LP2', label: 'CR00617' },
];

const START_DATE = '2026-04-11';
const END_DATE = '2026-04-11';

async function countInSheet(spreadsheetId: string, sheetName: string, targetPath: string, startDate: string, endDate: string): Promise<number> {
  if (!spreadsheetId) return 0;
  try {
    const response = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:Z` });
    const rows = response.data.values;
    if (!rows || rows.length === 0) return 0;
    const header = rows[0];
    let pathCol = -1, dateCol = -1;
    for (let i = 0; i < header.length; i++) {
      const h = String(header[i]).trim();
      if (['登録経路', '流入経路', 'ファネル登録経路'].includes(h)) pathCol = i;
      if (['登録日時', '登録日', 'アクション実行日時', '実行日時'].includes(h)) dateCol = i;
    }
    if (pathCol === -1 || dateCol === -1) return 0;
    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const pth = String(row[pathCol] || '').trim();
      const dateStr = String(row[dateCol] || '').trim();
      if (pth !== targetPath || !dateStr) continue;
      const m = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
      if (!m) continue;
      const d = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
      if (d >= startDate && d <= endDate) count++;
    }
    return count;
  } catch (e: any) {
    console.log(`  [err] ${sheetName}: ${e.message}`);
    return 0;
  }
}

async function getSmartPlusMetrics(advertiserId: string, startDate: string, endDate: string) {
  const result = new Map<string, { spend: number; impressions: number; clicks: number }>();
  let page = 1;
  while (true) {
    const qs = new URLSearchParams({
      advertiser_id: advertiserId,
      start_date: startDate, end_date: endDate,
      page: String(page), page_size: '100',
      dimensions: JSON.stringify(['smart_plus_ad_id','main_material_id']),
      metrics: JSON.stringify(['spend','impressions','clicks']),
    });
    const r = await fetch(`${API_BASE}/v1.3/smart_plus/material_report/overview/?${qs}`, { headers: { 'Access-Token': TOKEN } });
    const d: any = await r.json();
    if (d.code !== 0) { console.log(`  [err SP] ${d.message}`); break; }
    const list = d.data?.list || [];
    for (const row of list) {
      const id = String(row.dimensions?.smart_plus_ad_id);
      const cur = result.get(id) || { spend: 0, impressions: 0, clicks: 0 };
      cur.spend += parseFloat(row.metrics?.spend || '0');
      cur.impressions += parseInt(row.metrics?.impressions || '0');
      cur.clicks += parseInt(row.metrics?.clicks || '0');
      result.set(id, cur);
    }
    const total = d.data?.page_info?.total_number || 0;
    if (page * 100 >= total || list.length === 0) break;
    page++;
  }
  return result;
}

async function main() {
  console.log(`期間: ${START_DATE} 〜 ${END_DATE}\n`);
  const metrics = await getSmartPlusMetrics(ADV_ID, START_DATE, END_DATE);
  console.log(`Smart+ metrics取得: ${metrics.size}件\n`);

  const rows: string[] = [];
  rows.push('広告名,コスト,インプレッション,CPM,CTR,CPA,フロント販売本数,フロントCPO');

  for (const a of ADS) {
    const m = metrics.get(a.adId) || { spend: 0, impressions: 0, clicks: 0 };
    const spend = Math.round(m.spend);
    const imp = m.impressions;
    const cpm = imp > 0 ? Math.round((m.spend / imp) * 1000) : 0;
    const ctr = imp > 0 ? ((m.clicks / imp) * 100).toFixed(2) + '％' : '0％';

    const regPath = `TikTok広告-スキルプラス-${a.lp}-${a.cr}`;
    const cv = await countInSheet(CV_SHEET_ID, 'TT_オプト', regPath, START_DATE, END_DATE);
    const frontOTO = await countInSheet(FRONT_SHEET_ID, 'TT【OTO】', regPath, START_DATE, END_DATE);
    const front3day = await countInSheet(FRONT_SHEET_ID, 'TT【3day】', regPath, START_DATE, END_DATE);
    const front = frontOTO + front3day;

    const cpa = cv > 0 ? Math.round(m.spend / cv) : 0;
    const cpo = front > 0 ? Math.round(m.spend / front) : 0;

    const label = `おい会社員/${a.label}`;
    console.log(`${label}: spend=¥${spend}, imp=${imp}, clicks=${m.clicks}, CV=${cv}, front=${front}`);
    rows.push([label, spend, imp, cpm, ctr, cpa, front, cpo].join(','));
  }

  const outPath = path.join(__dirname, 'exports', 'shimizu_3crs_result.csv');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, '\uFEFF' + rows.join('\n'));
  console.log(`\nCSV出力: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
