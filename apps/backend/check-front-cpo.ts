/**
 * 指定CRのフロントCPO確認スクリプト
 * - TT_オプト: CV数
 * - TT【OTO】+ TT【3day】: フロント販売数
 * - TikTok API: 広告費（通常 + Smart+両方試す）
 */
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
dotenv.config();

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheetsApi = google.sheets({ version: 'v4', auth });

const TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const API_BASE = 'https://business-api.tiktok.com/open_api';

// チェック対象
const TARGETS = [
  {
    label: 'LP2-CR00230 (AI_2)',
    appealName: 'AI',
    cvSpreadsheetId: '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk',
    frontSpreadsheetId: '1PvyM6JkFuQR_lc4QyZFaMX0GA0Rn0_6Bll9mjh0RNFs',
    registrationPath: 'TikTok広告-AI-LP2-CR00230',
    advertiserId: '7523128243466551303',
    adTiktokId: '1860117023321169',
    targetFrontCPO: 150000, // AI導線の目標フロントCPO
  },
  {
    label: 'LP1-CR00619 (SNS_2)',
    appealName: 'SNS',
    cvSpreadsheetId: '1JlEC8rQAM3h2E7GuUplMPrLyVdA5Q3nZ0lGneC2nZvY',
    frontSpreadsheetId: '14xhgh-Ad-Ont1wK-L4ZOyS8KgIfvoQX7zUGImH5hwKU',
    registrationPath: 'TikTok広告-SNS-LP1-CR00619',
    advertiserId: '7543540100849156112',
    adTiktokId: '', // 後で特定
    targetFrontCPO: 100000,
  },
  {
    label: 'LP2-CR00468 (SP1)',
    appealName: 'スキルプラス',
    cvSpreadsheetId: '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk',
    frontSpreadsheetId: '', // SPはフロントシートが別
    registrationPath: 'TikTok広告-スキルプラス-LP2-CR00468',
    advertiserId: '7474920444831875080',
    adTiktokId: '1858931396655186',
    targetFrontCPO: 0, // SP導線はフロントCPOなし
  },
  {
    label: 'LP2-CR00494 (SP1)',
    appealName: 'スキルプラス',
    cvSpreadsheetId: '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk',
    frontSpreadsheetId: '',
    registrationPath: 'TikTok広告-スキルプラス-LP2-CR00494',
    advertiserId: '7474920444831875080',
    adTiktokId: '',
    targetFrontCPO: 0,
  },
  {
    label: 'LP2-CR00511 (SP2)',
    appealName: 'スキルプラス',
    cvSpreadsheetId: '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk',
    frontSpreadsheetId: '',
    registrationPath: 'TikTok広告-スキルプラス-LP2-CR00511',
    advertiserId: '7592868952431362066',
    adTiktokId: '',
    targetFrontCPO: 0,
  },
];

async function countInSheet(
  spreadsheetId: string,
  sheetName: string,
  targetPath: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  if (!spreadsheetId) return 0;
  try {
    const response = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });
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
      const path = String(row[pathCol] || '').trim();
      const dateStr = String(row[dateCol] || '').trim();
      if (path !== targetPath || !dateStr) continue;
      const dateMatch = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
      if (!dateMatch) continue;
      const d = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
      if (d >= startDate && d <= endDate) count++;
    }
    return count;
  } catch (e) {
    return 0;
  }
}

// 全広告のspendを取得（通常 + Smart+統合）
async function getAllAdSpend(advertiserId: string, startDate: string, endDate: string): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  // 通常広告
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const params = new URLSearchParams();
    params.set('advertiser_id', advertiserId);
    params.set('data_level', 'AUCTION_AD');
    params.set('report_type', 'BASIC');
    params.set('dimensions', JSON.stringify(['ad_id']));
    params.set('metrics', JSON.stringify(['spend']));
    params.set('start_date', startDate);
    params.set('end_date', endDate);
    params.set('page', String(page));
    params.set('page_size', '1000');

    const resp = await fetch(`${API_BASE}/v1.3/report/integrated/get/?${params.toString()}`, {
      headers: { 'Access-Token': TOKEN },
    });
    const data = await resp.json() as any;
    if (data.code !== 0) break;
    const list = data.data?.list || [];
    for (const r of list) {
      const adId = String(r.dimensions?.ad_id);
      result.set(adId, parseFloat(r.metrics?.spend || '0'));
    }
    const totalPages = Math.ceil((data.data?.page_info?.total_number || 0) / 1000);
    hasMore = page < totalPages && list.length > 0;
    page++;
  }

  // Smart+
  page = 1;
  hasMore = true;
  while (hasMore) {
    const params = new URLSearchParams();
    params.set('advertiser_id', advertiserId);
    params.set('start_date', startDate);
    params.set('end_date', endDate);
    params.set('page', String(page));
    params.set('page_size', '100');
    params.set('dimensions', JSON.stringify(['smart_plus_ad_id', 'main_material_id']));
    params.set('metrics', JSON.stringify(['spend']));

    const resp = await fetch(`${API_BASE}/v1.3/smart_plus/material_report/overview/?${params.toString()}`, {
      headers: { 'Access-Token': TOKEN },
    });
    const data = await resp.json() as any;
    if (data.code !== 0) break;
    const list = data.data?.list || [];
    for (const r of list) {
      const adId = String(r.dimensions?.smart_plus_ad_id);
      const spend = parseFloat(r.metrics?.spend || '0');
      result.set(adId, (result.get(adId) || 0) + spend);
    }
    const totalPages = Math.ceil((data.data?.page_info?.total_number || 0) / 100);
    hasMore = page < totalPages && list.length > 0;
    page++;
  }

  return result;
}

async function main() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = jst.toISOString().split('T')[0];
  const yesterdayStr = new Date(jst.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const start7d = new Date(jst.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const start30d = new Date(jst.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // 各アカウントのspendを事前取得（API呼び出し回数削減）
  const spendCache = new Map<string, Map<string, number>>();

  for (const t of TARGETS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${t.label}`);
    console.log(`登録経路: ${t.registrationPath}`);
    console.log(`${'='.repeat(60)}`);

    for (const [label, sDate, eDate, spendStart, spendEnd] of [
      ['直近7日', start7d, todayStr, start7d, yesterdayStr],
      ['直近30日', start30d, todayStr, start30d, yesterdayStr],
    ] as [string, string, string, string, string][]) {
      console.log(`\n--- ${label} ---`);

      const cv = await countInSheet(t.cvSpreadsheetId, 'TT_オプト', t.registrationPath, sDate, eDate);
      const frontOTO = await countInSheet(t.frontSpreadsheetId, 'TT【OTO】', t.registrationPath, sDate, eDate);
      const front3day = await countInSheet(t.frontSpreadsheetId, 'TT【3day】', t.registrationPath, sDate, eDate);
      const frontTotal = frontOTO + front3day;

      // spend取得
      const cacheKey = `${t.advertiserId}_${spendStart}_${spendEnd}`;
      if (!spendCache.has(cacheKey)) {
        console.log(`  API取得中...`);
        spendCache.set(cacheKey, await getAllAdSpend(t.advertiserId, spendStart, spendEnd));
      }
      const spendMap = spendCache.get(cacheKey)!;
      const spend = t.adTiktokId ? (spendMap.get(t.adTiktokId) || 0) : 0;

      // adTiktokIdが空の場合、登録経路のlpNameで検索
      let actualSpend = spend;
      if (!t.adTiktokId) {
        // lpNameを含む全広告のspendを合算
        // DB使わずにスキップ（adTiktokIdを後で手動指定）
        console.log(`  (adTiktokId未指定のためspend不明)`);
      }

      const cpa = cv > 0 && actualSpend > 0 ? `¥${Math.round(actualSpend / cv).toLocaleString()}` : (cv > 0 ? 'spend不明' : '∞');
      const frontCPO = frontTotal > 0 && actualSpend > 0 ? `¥${Math.round(actualSpend / frontTotal).toLocaleString()}` : (frontTotal > 0 ? 'spend不明' : '∞');

      console.log(`  CV(オプト): ${cv}`);
      console.log(`  フロント: ${frontTotal} (OTO: ${frontOTO}, 3day: ${front3day})`);
      console.log(`  広告費: ¥${Math.round(actualSpend).toLocaleString()}`);
      console.log(`  CPA: ${cpa}`);
      console.log(`  フロントCPO: ${frontCPO}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
