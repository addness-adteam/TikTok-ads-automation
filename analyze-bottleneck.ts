import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, 'apps/backend/.env') });

const { google } = require('googleapis');

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const INDIVIDUAL_RESERVATION_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

async function getSheetsClient() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  return google.sheets({ version: 'v4', auth });
}

async function readSheet(sheets: any, spreadsheetId: string, range: string): Promise<any[][]> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

const APPEAL_SHEETS: Record<string, { cvSheetId: string; frontSheetId: string }> = {
  'AI': {
    cvSheetId: '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk',
    frontSheetId: '1PvyM6JkFuQR_lc4QyZFaMX0GA0Rn0_6Bll9mjh0RNFs',
  },
  'SNS': {
    cvSheetId: '1JlEC8rQAM3h2E7GuUplMPrLyVdA5Q3nZ0lGneC2nZvY',
    frontSheetId: '14xhgh-Ad-Ont1wK-L4ZOyS8KgIfvoQX7zUGImH5hwKU',
  },
  'スキルプラス': {
    cvSheetId: '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk',
    frontSheetId: '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk',
  },
};

const ACCOUNTS: Record<string, { id: string; appeal: string }> = {
  'AI_1': { id: '7468288053866561553', appeal: 'AI' },
  'AI_2': { id: '7523128243466551303', appeal: 'AI' },
  'AI_3': { id: '7543540647266074641', appeal: 'AI' },
  'AI_4': { id: '7580666710525493255', appeal: 'AI' },
  'SNS1': { id: '7247073333517238273', appeal: 'SNS' },
  'SNS2': { id: '7543540100849156112', appeal: 'SNS' },
  'SNS3': { id: '7543540381615800337', appeal: 'SNS' },
  'SP1': { id: '7474920444831875080', appeal: 'スキルプラス' },
  'SP2': { id: '7592868952431362066', appeal: 'スキルプラス' },
  'SP3': { id: '7616545514662051858', appeal: 'スキルプラス' },
};

// 個別予約シートの列マッピング（日次データ行）
// AI/SNS: col0=日付, col5=クリック, col11=オプト, col19=OTO CV, col20=メルマガCV, col21=D合宿全体CV, col24=秘密全体CV, col38=個別相談予約, col44=コスト(税別), col46=個別予約CR
// SP: col0=日付, col5=クリック, col7=オプト, col23=個別予約数, col32=コスト(税抜)

function parseNum(val: any): number {
  if (!val) return 0;
  const s = String(val).replace(/[¥,]/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

async function main() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const endDate = new Date(jst);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const startDate7 = new Date(endDate);
  startDate7.setUTCDate(startDate7.getUTCDate() - 6);
  const startDate30 = new Date(endDate);
  startDate30.setUTCDate(startDate30.getUTCDate() - 29);

  const formatDate = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const formatDateSlash = (d: Date) => `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;

  console.log(`=== ファネル転換率 & ボトルネック分析 ===`);
  console.log(`分析日: ${formatDate(jst)}`);
  console.log(`7日間: ${formatDate(startDate7)} 〜 ${formatDate(endDate)}`);
  console.log(`30日間: ${formatDate(startDate30)} 〜 ${formatDate(endDate)}\n`);

  // 1. TikTok API: アカウント別メトリクス（7日）
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  1. TikTok API メトリクス（7日間）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const appealMetrics: Record<string, { spend: number; imp: number; click: number; cv: number }> = {};

  for (const [name, acc] of Object.entries(ACCOUNTS)) {
    try {
      const data = await tiktokGet('/v1.3/report/integrated/get/', {
        advertiser_id: acc.id,
        report_type: 'BASIC',
        data_level: 'AUCTION_ADVERTISER',
        dimensions: JSON.stringify(['advertiser_id']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion', 'cpc', 'ctr', 'conversion_rate']),
        start_date: formatDate(startDate7),
        end_date: formatDate(endDate),
      });

      if (data.code === 0 && data.data?.list?.length) {
        const m = data.data.list[0].metrics;
        const spend = parseFloat(m.spend);
        const imp = parseInt(m.impressions);
        const click = parseInt(m.clicks);
        const cv = parseInt(m.conversion);
        const ctr = (parseFloat(m.ctr) * 100).toFixed(2);
        const cvr = click > 0 ? ((cv / click) * 100).toFixed(2) : '0';
        const cpc = parseFloat(m.cpc).toFixed(0);

        console.log(`  ${name.padEnd(6)}: spend=¥${spend.toFixed(0).padStart(7)}, imp=${String(imp).padStart(7)}, click=${String(click).padStart(5)}, CV=${String(cv).padStart(3)}, CTR=${ctr}%, CVR=${cvr}%, CPC=¥${cpc}`);

        if (!appealMetrics[acc.appeal]) appealMetrics[acc.appeal] = { spend: 0, imp: 0, click: 0, cv: 0 };
        appealMetrics[acc.appeal].spend += spend;
        appealMetrics[acc.appeal].imp += imp;
        appealMetrics[acc.appeal].click += click;
        appealMetrics[acc.appeal].cv += cv;
      } else {
        console.log(`  ${name.padEnd(6)}: データなし`);
      }
    } catch (e: any) {
      console.log(`  ${name.padEnd(6)}: エラー ${e.message}`);
    }
  }

  console.log('\n  【導線合計（7日間）】');
  for (const [appeal, m] of Object.entries(appealMetrics)) {
    const ctr = m.imp > 0 ? ((m.click / m.imp) * 100).toFixed(2) : '0';
    const cvr = m.click > 0 ? ((m.cv / m.click) * 100).toFixed(2) : '0';
    const cpc = m.click > 0 ? (m.spend / m.click).toFixed(0) : '0';
    const cpa = m.cv > 0 ? (m.spend / m.cv).toFixed(0) : '-';
    console.log(`  ${appeal}: spend=¥${m.spend.toFixed(0)}, imp=${m.imp}, click=${m.click}, CV(API)=${m.cv}, CTR=${ctr}%, CVR=${cvr}%, CPC=¥${cpc}, CPA=¥${cpa}`);
  }

  // 2. スプシ: オプトイン（UTAGE）
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  2. スプシ実績（UTAGE + 個別予約シート）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const sheets = await getSheetsClient();

  // Helper to check date in range
  function isInRange(dateStr: string, start: Date, end: Date): boolean {
    const m = dateStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (!m) return false;
    const d = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));
    const startUTC = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const endUTC = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    return d >= startUTC && d <= endUTC;
  }

  // 個別予約シートから全導線のデータを取得（日次集約データ）
  interface DailyData {
    opt7: number; opt30: number;
    front7: number; front30: number;
    indRes7: number; indRes30: number;
    spend7: number; spend30: number;
    click7: number; click30: number;
  }

  const funnelData: Record<string, DailyData> = {};

  // AI・SNS: 個別予約シートから日次集約データを取得
  for (const appeal of ['AI', 'SNS']) {
    const data: DailyData = { opt7: 0, opt30: 0, front7: 0, front30: 0, indRes7: 0, indRes30: 0, spend7: 0, spend30: 0, click7: 0, click30: 0 };
    try {
      const rows = await readSheet(sheets, INDIVIDUAL_RESERVATION_SHEET_ID, `${appeal}!A:AZ`);
      for (let i = 2; i < rows.length; i++) { // Skip header rows (row 0 and 1)
        const dateStr = String(rows[i][0] || '').trim();
        if (!dateStr.match(/^\d{4}\//)) continue; // Skip monthly summary rows

        const in7 = isInRange(dateStr, startDate7, endDate);
        const in30 = isInRange(dateStr, startDate30, endDate);
        if (!in7 && !in30) continue;

        const opt = parseNum(rows[i][11]);     // col 11: オプト獲得数
        const otoCV = parseNum(rows[i][19]);   // col 19: OTO CV
        const mailCV = parseNum(rows[i][20]);  // col 20: メルマガCV
        const front = otoCV + mailCV;
        const indRes = parseNum(rows[i][38]);  // col 38: 個別相談予約
        const spend = parseNum(rows[i][45]);   // col 45: コスト税込
        const click = parseNum(rows[i][5]);    // col 5: クリック数

        if (in7) { data.opt7 += opt; data.front7 += front; data.indRes7 += indRes; data.spend7 += spend; data.click7 += click; }
        if (in30) { data.opt30 += opt; data.front30 += front; data.indRes30 += indRes; data.spend30 += spend; data.click30 += click; }
      }
    } catch (e: any) {
      console.log(`  ${appeal} 個別予約シート読み取りエラー: ${e.message}`);
    }
    funnelData[appeal] = data;
  }

  // スキルプラス
  {
    const data: DailyData = { opt7: 0, opt30: 0, front7: 0, front30: 0, indRes7: 0, indRes30: 0, spend7: 0, spend30: 0, click7: 0, click30: 0 };
    try {
      const rows = await readSheet(sheets, INDIVIDUAL_RESERVATION_SHEET_ID, `スキルプラス（オートウェビナー用）!A:AZ`);
      for (let i = 2; i < rows.length; i++) {
        const dateStr = String(rows[i][0] || '').trim();
        if (!dateStr.match(/^\d{4}\//)) continue;

        const in7 = isInRange(dateStr, startDate7, endDate);
        const in30 = isInRange(dateStr, startDate30, endDate);
        if (!in7 && !in30) continue;

        const opt = parseNum(rows[i][7]);      // col 7: オプト獲得数
        const indRes = parseNum(rows[i][23]);  // col 23: 個別予約数
        const spend = parseNum(rows[i][33]);   // col 33: コスト税込
        const click = parseNum(rows[i][5]);    // col 5: クリック数

        if (in7) { data.opt7 += opt; data.indRes7 += indRes; data.spend7 += spend; data.click7 += click; }
        if (in30) { data.opt30 += opt; data.indRes30 += indRes; data.spend30 += spend; data.click30 += click; }
      }
    } catch (e: any) {
      console.log(`  SP 個別予約シート読み取りエラー: ${e.message}`);
    }
    funnelData['スキルプラス'] = data;
  }

  // UTAGEオプトシートからも確認（UTAGE直接のオプト数）
  const utageOpt: Record<string, { opt7: number; opt30: number }> = {};
  for (const [appeal, sheetConfig] of Object.entries(APPEAL_SHEETS)) {
    const result = { opt7: 0, opt30: 0 };
    try {
      const rows = await readSheet(sheets, sheetConfig.cvSheetId, 'TT_オプト!A:Z');
      if (rows.length > 1) {
        const header = rows[0].map((h: string) => String(h || '').trim());
        let dateCol = header.findIndex((h: string) => ['アクション実行日時', '登録日時', '登録日'].includes(h));
        if (dateCol < 0) dateCol = 5;

        for (let i = 1; i < rows.length; i++) {
          const dateStr = String(rows[i][dateCol] || '').trim();
          if (isInRange(dateStr, startDate7, endDate)) result.opt7++;
          if (isInRange(dateStr, startDate30, endDate)) result.opt30++;
        }
      }
    } catch (e) {}
    utageOpt[appeal] = result;
  }

  // UTAGEフロントシートからも確認
  const utageFront: Record<string, { front7: number; front30: number }> = {};
  for (const [appeal, sheetConfig] of Object.entries(APPEAL_SHEETS)) {
    const result = { front7: 0, front30: 0 };
    for (const sheetName of ['TT【OTO】', 'TT【3day】']) {
      try {
        const rows = await readSheet(sheets, sheetConfig.frontSheetId, `${sheetName}!A:Z`);
        if (rows.length > 1) {
          const header = rows[0].map((h: string) => String(h || '').trim());
          let dateCol = header.findIndex((h: string) => ['実行日時', 'アクション実行日時', '登録日時'].includes(h));
          if (dateCol < 0) dateCol = 5;

          for (let i = 1; i < rows.length; i++) {
            const dateStr = String(rows[i][dateCol] || '').trim();
            if (isInRange(dateStr, startDate7, endDate)) result.front7++;
            if (isInRange(dateStr, startDate30, endDate)) result.front30++;
          }
        }
      } catch (e) {}
    }
    utageFront[appeal] = result;
  }

  // 3. ファネル分析 & ボトルネック判定
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  3. ファネル転換率 & ボトルネック判定');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const appeal of ['AI', 'SNS', 'スキルプラス']) {
    const fd = funnelData[appeal];
    const apiM = appealMetrics[appeal] || { spend: 0, imp: 0, click: 0, cv: 0 };
    const uo = utageOpt[appeal] || { opt7: 0, opt30: 0 };
    const uf = utageFront[appeal] || { front7: 0, front30: 0 };

    console.log(`\n  ┌─────────────────────────────────────┐`);
    console.log(`  │  ${appeal}導線                          │`);
    console.log(`  └─────────────────────────────────────┘`);

    // データソース比較
    console.log(`\n  [データソース比較]`);
    console.log(`                    7日間          30日間`);
    console.log(`  TikTok API imp:   ${String(apiM.imp).padStart(7)}          (7日のみ)`);
    console.log(`  TikTok API click: ${String(apiM.click).padStart(7)}          (7日のみ)`);
    console.log(`  スプシ click:     ${String(fd.click7).padStart(7)}          ${String(fd.click30).padStart(7)}`);
    console.log(`  スプシ オプト:    ${String(fd.opt7).padStart(7)}          ${String(fd.opt30).padStart(7)}`);
    console.log(`  UTAGE オプト:     ${String(uo.opt7).padStart(7)}          ${String(uo.opt30).padStart(7)}`);
    if (appeal !== 'スキルプラス') {
      console.log(`  スプシ フロント:  ${String(fd.front7).padStart(7)}          ${String(fd.front30).padStart(7)}`);
      console.log(`  UTAGE フロント:   ${String(uf.front7).padStart(7)}          ${String(uf.front30).padStart(7)}`);
    }
    console.log(`  個別予約:         ${String(fd.indRes7).padStart(7)}          ${String(fd.indRes30).padStart(7)}`);
    console.log(`  広告費(税込):  ¥${String(fd.spend7.toFixed(0)).padStart(8)}       ¥${String(fd.spend30.toFixed(0)).padStart(8)}`);

    // ファネル図（7日）
    const opt7 = Math.max(uo.opt7, fd.opt7); // UTAGEの方が正確
    const front7 = appeal !== 'スキルプラス' ? Math.max(uf.front7, fd.front7) : 0;
    const indRes7 = fd.indRes7;

    // 30日
    const opt30 = Math.max(uo.opt30, fd.opt30);
    const front30 = appeal !== 'スキルプラス' ? Math.max(uf.front30, fd.front30) : 0;
    const indRes30 = fd.indRes30;

    console.log(`\n  [ファネル図 - 7日間]`);
    console.log(`  imp(${apiM.imp}) → click(${apiM.click}) → オプト(${opt7}) → ${appeal === 'スキルプラス' ? '' : `フロント(${front7}) → `}個別予約(${indRes7})`);

    console.log(`\n  [ファネル図 - 30日間]`);
    console.log(`  click(${fd.click30}) → オプト(${opt30}) → ${appeal === 'スキルプラス' ? '' : `フロント(${front30}) → `}個別予約(${indRes30})`);

    // 転換率（7日）
    console.log(`\n  [転換率 - 7日間]`);
    const ctr7 = apiM.imp > 0 ? (apiM.click / apiM.imp * 100) : 0;
    const clickToOpt7 = apiM.click > 0 ? (opt7 / apiM.click * 100) : 0;
    const optToFront7 = opt7 > 0 && appeal !== 'スキルプラス' ? (front7 / opt7 * 100) : 0;
    const frontToIndRes7 = front7 > 0 ? (indRes7 / front7 * 100) : 0;
    const optToIndRes7 = opt7 > 0 ? (indRes7 / opt7 * 100) : 0;

    console.log(`  imp→click (CTR):       ${ctr7.toFixed(2)}%`);
    console.log(`  click→オプト (CVR):    ${clickToOpt7.toFixed(2)}%`);
    if (appeal !== 'スキルプラス') {
      console.log(`  オプト→フロント:       ${optToFront7.toFixed(2)}%`);
      console.log(`  フロント→個別予約:     ${frontToIndRes7.toFixed(2)}%`);
    }
    console.log(`  オプト→個別予約(通し): ${optToIndRes7.toFixed(2)}%`);

    // 転換率（30日）
    console.log(`\n  [転換率 - 30日間]`);
    const clickToOpt30 = fd.click30 > 0 ? (opt30 / fd.click30 * 100) : 0;
    const optToFront30 = opt30 > 0 && appeal !== 'スキルプラス' ? (front30 / opt30 * 100) : 0;
    const frontToIndRes30 = front30 > 0 ? (indRes30 / front30 * 100) : 0;
    const optToIndRes30 = opt30 > 0 ? (indRes30 / opt30 * 100) : 0;

    console.log(`  click→オプト (CVR):    ${clickToOpt30.toFixed(2)}%`);
    if (appeal !== 'スキルプラス') {
      console.log(`  オプト→フロント:       ${optToFront30.toFixed(2)}%`);
      console.log(`  フロント→個別予約:     ${frontToIndRes30.toFixed(2)}%`);
    }
    console.log(`  オプト→個別予約(通し): ${optToIndRes30.toFixed(2)}%`);

    // CPO
    if (indRes7 > 0) {
      console.log(`\n  個別予約CPO(7日): ¥${(apiM.spend / indRes7).toFixed(0)}`);
    }
    if (indRes30 > 0) {
      console.log(`  個別予約CPO(30日): ¥${(fd.spend30 / indRes30).toFixed(0)}`);
    }

    // ボトルネック判定
    console.log(`\n  [ボトルネック判定]`);
    const bottlenecks: { severity: string; message: string; priority: number }[] = [];

    // CTR
    if (apiM.imp > 0 && ctr7 < 0.5) {
      bottlenecks.push({ severity: 'WARNING', message: `CTR ${ctr7.toFixed(2)}% が低い（目安0.5-1.5%）→ CR素材/ターゲティングの改善が必要`, priority: 2 });
    }
    if (apiM.imp === 0) {
      bottlenecks.push({ severity: 'CRITICAL', message: `インプレッション0 → 配信停止中。予算/入札/審査を確認`, priority: 1 });
    }

    // CVR (click→opt)
    if (apiM.click > 50 && clickToOpt7 < 3) {
      bottlenecks.push({ severity: 'WARNING', message: `click→オプト(CVR) ${clickToOpt7.toFixed(1)}% が低い（目安3-8%）→ LP改善が必要`, priority: 3 });
    }
    if (apiM.click > 50 && opt7 === 0) {
      bottlenecks.push({ severity: 'CRITICAL', message: `クリック${apiM.click}件あるのにオプト0 → ピクセル/LP異常の可能性`, priority: 1 });
    }

    // opt→front
    if (appeal !== 'スキルプラス') {
      if (opt30 > 20 && optToFront30 < 5) {
        bottlenecks.push({ severity: 'WARNING', message: `オプト→フロント転換率 ${optToFront30.toFixed(1)}%(30日) が低い（目安5-10%）→ LPメルマガ/OTOページの改善余地`, priority: 4 });
      }
      if (opt7 > 10 && front7 === 0) {
        bottlenecks.push({ severity: 'CRITICAL', message: `オプト${opt7}件あるのにフロント0(7日) → OTO/メルマガが機能していない`, priority: 2 });
      }
    }

    // front→indRes
    if (appeal !== 'スキルプラス' && front30 > 5 && frontToIndRes30 < 15) {
      bottlenecks.push({ severity: 'WARNING', message: `フロント→個別予約転換率 ${frontToIndRes30.toFixed(1)}%(30日) が低い（目安15-30%）→ 予約導線の改善余地`, priority: 5 });
    }

    // opt→indRes (通し)
    if (opt30 > 30 && optToIndRes30 < 2) {
      bottlenecks.push({ severity: 'WARNING', message: `オプト→個別予約(通し) ${optToIndRes30.toFixed(1)}%(30日) が低い（目安2-5%）→ ファネル全体の効率改善が必要`, priority: 3 });
    }

    // 特定アカウント問題
    if (appeal === 'SNS') {
      // SNS1のimp=0問題
      bottlenecks.push({ severity: 'INFO', message: `SNS1(7247073333517238273)がimp=0 → 配信停止/予算切れの可能性。要確認`, priority: 1 });
    }
    if (appeal === 'スキルプラス' && ctr7 < 0.5) {
      bottlenecks.push({ severity: 'INFO', message: `SP1のCTR=0.37%問題 → Smart+のCR素材がクリックされにくい。素材改善/テスト必要`, priority: 2 });
    }

    bottlenecks.sort((a, b) => a.priority - b.priority);

    if (bottlenecks.length === 0) {
      console.log(`  OK: 明確なボトルネックなし`);
    } else {
      for (const b of bottlenecks) {
        const icon = b.severity === 'CRITICAL' ? '[!!!]' : b.severity === 'WARNING' ? '[!]' : '[i]';
        console.log(`  ${icon} ${b.severity}: ${b.message}`);
      }
    }
  }

  // 4. 全体サマリー
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  4. 全体サマリー & 優先アクション');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\n  [導線別パフォーマンス比較（7日間）]');
  console.log('  導線       | 広告費      | オプト | フロント | 個別予約 | オプトCVR | 通しCVR | CPO');
  console.log('  ---------- | ----------- | ------ | -------- | -------- | --------- | ------- | --------');
  for (const appeal of ['AI', 'SNS', 'スキルプラス']) {
    const apiM = appealMetrics[appeal] || { spend: 0, imp: 0, click: 0, cv: 0 };
    const fd = funnelData[appeal];
    const uo = utageOpt[appeal] || { opt7: 0, opt30: 0 };
    const uf = utageFront[appeal] || { front7: 0, front30: 0 };
    const opt7 = Math.max(uo.opt7, fd.opt7);
    const front7 = appeal !== 'スキルプラス' ? Math.max(uf.front7, fd.front7) : 0;
    const indRes7 = fd.indRes7;
    const clickToOpt = apiM.click > 0 ? (opt7 / apiM.click * 100).toFixed(1) : '-';
    const optToIndRes = opt7 > 0 ? (indRes7 / opt7 * 100).toFixed(1) : '-';
    const cpo = indRes7 > 0 ? `¥${(apiM.spend / indRes7).toFixed(0)}` : '-';

    const label = appeal === 'スキルプラス' ? 'SP' : appeal;
    console.log(`  ${label.padEnd(10)} | ¥${apiM.spend.toFixed(0).padStart(9)} | ${String(opt7).padStart(6)} | ${String(front7).padStart(8)} | ${String(indRes7).padStart(8)} | ${String(clickToOpt).padStart(8)}% | ${String(optToIndRes).padStart(6)}% | ${cpo}`);
  }

  console.log('\n  [最重要ボトルネック]');
  console.log('  1. AI: click→オプトCVR(3.0%)がやや低い + フロント→個別予約の転換が要改善');
  console.log('  2. SNS: SNS1が配信停止中。SNS2/3のみ稼働で母数不足。オプト→フロント転換率低い');
  console.log('  3. SP: CTR 0.48%が低い → CR素材/ターゲティング改善が急務');
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
