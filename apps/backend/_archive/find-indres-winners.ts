/**
 * 個別予約が取れている動画を特定
 * - 個別予約シートから直近30日のLP-CR別予約数
 * - 対応する広告の動画IDと広告費を突合
 * - 個別予約CPOがKPI以内の動画をランキング
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const INDIVIDUAL_RESERVATION_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

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

const RESERVATION_CONFIG: Record<string, { sheetName: string; dateCol: number; pathCol: number }> = {
  'AI': { sheetName: 'AI', dateCol: 0, pathCol: 46 },
  'SNS': { sheetName: 'SNS', dateCol: 0, pathCol: 46 },
  'スキルプラス': { sheetName: 'スキルプラス（オートウェビナー用）', dateCol: 0, pathCol: 34 },
};

const KPI: Record<string, number> = { 'AI': 53795, 'SNS': 37753, 'スキルプラス': 48830 };

function jstDate(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')}`;
}

async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 3600000);
  const endDate = new Date(`${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(jstNow.getUTCDate()).padStart(2, '0')}T23:59:59+09:00`);
  const startDate30 = new Date(endDate.getTime() - 30 * 86400000);

  console.log('=== 個別予約が取れている動画ランキング ===\n');

  // 1. 個別予約シートから30日分のLP-CR別予約数を取得
  console.log('1. 個別予約シート読み込み...');
  const indResMap = new Map<string, { count: number; appeal: string }>(); // LP-CR → count

  for (const [appeal, config] of Object.entries(RESERVATION_CONFIG)) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: INDIVIDUAL_RESERVATION_SHEET_ID,
      range: `${config.sheetName}!A:AZ`,
    });
    const rows: any[][] = res.data.values || [];
    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const dateStr = String(row[config.dateCol] || '').trim();
      const pathValue = row[config.pathCol];
      if (!dateStr || !pathValue) continue;
      const m = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (!m) continue;
      const rowDate = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), -9, 0, 0));
      if (rowDate < startDate30 || rowDate > endDate) continue;
      const lines = String(pathValue).split('\n');
      for (const line of lines) {
        const lpCrMatch = line.trim().match(/(LP\d+-CR\d+)/i);
        if (lpCrMatch) {
          const lpCr = lpCrMatch[1].toUpperCase();
          const existing = indResMap.get(lpCr);
          if (existing) existing.count++;
          else indResMap.set(lpCr, { count: 1, appeal });
          count++;
        }
      }
    }
    console.log(`  ${appeal}: ${count}件`);
  }

  // LP-CR別で予約多い順にソート
  const sortedLpCrs = [...indResMap.entries()].sort((a, b) => b[1].count - a[1].count);
  console.log(`\n個別予約があるLP-CR: ${sortedLpCrs.length}種類`);
  for (const [lpCr, data] of sortedLpCrs.slice(0, 30)) {
    console.log(`  ${lpCr}: ${data.count}件 (${data.appeal})`);
  }

  // 2. 各LP-CRに対応する広告のvideo_idと累計広告費を取得
  console.log('\n2. 広告のvideo_idと広告費を取得...');

  interface VideoInfo {
    lpCr: string; videoId: string; adName: string; accountName: string; accId: string;
    appeal: string; totalSpend: number; indResCount: number; cpo: number;
  }

  const videoInfos: VideoInfo[] = [];
  const reportStart = jstDate(new Date(now.getTime() - 30 * 86400000));
  const reportEnd = jstDate(now);

  for (const acc of ACCOUNTS) {
    // LP-CRがこのアカウントのappealに合致するものだけ
    const relevantLpCrs = sortedLpCrs.filter(([_, data]) => data.appeal === acc.appeal);
    if (relevantLpCrs.length === 0) continue;

    // 広告取得
    let page = 1;
    const adsByCr = new Map<string, { adId: string; adName: string; videoId: string; campaignId: string }[]>();
    while (true) {
      const resp = await get('/v1.3/ad/get/', {
        advertiser_id: acc.id, page_size: '100', page: String(page),
        fields: JSON.stringify(['ad_id', 'ad_name', 'video_id', 'campaign_id']),
      });
      if (resp.code !== 0) break;
      for (const ad of resp.data?.list || []) {
        const m = ad.ad_name?.match(/(LP\d+-CR\d+)/i);
        if (!m) continue;
        const lpCr = m[1].toUpperCase();
        if (!adsByCr.has(lpCr)) adsByCr.set(lpCr, []);
        adsByCr.get(lpCr)!.push({ adId: ad.ad_id, adName: ad.ad_name, videoId: ad.video_id, campaignId: ad.campaign_id });
      }
      if ((resp.data?.list || []).length < 100) break;
      page++;
    }

    // Smart+広告も確認
    let spPage = 1;
    while (true) {
      const resp = await get('/v1.3/smart_plus/ad/get/', {
        advertiser_id: acc.id,
        fields: JSON.stringify(['smart_plus_ad_id', 'ad_name', 'creative_list', 'campaign_id']),
        page_size: '100', page: String(spPage),
      });
      if (resp.code !== 0) break;
      for (const ad of resp.data?.list || []) {
        const m = ad.ad_name?.match(/(LP\d+-CR\d+)/i);
        if (!m) continue;
        const lpCr = m[1].toUpperCase();
        // Smart+のcreative_listから各動画を紐づけ
        for (const c of ad.creative_list || []) {
          const vid = c?.creative_info?.video_info?.video_id;
          if (vid) {
            if (!adsByCr.has(lpCr)) adsByCr.set(lpCr, []);
            adsByCr.get(lpCr)!.push({ adId: ad.smart_plus_ad_id, adName: ad.ad_name, videoId: vid, campaignId: ad.campaign_id });
          }
        }
      }
      if ((resp.data?.list || []).length < 100) break;
      spPage++;
    }

    // 各LP-CRの広告費を取得（キャンペーン単位）
    for (const [lpCr, data] of relevantLpCrs) {
      const ads = adsByCr.get(lpCr);
      if (!ads || ads.length === 0) continue;

      // キャンペーン単位で広告費を合算
      const campIds = [...new Set(ads.map(a => a.campaignId))];
      let totalSpend = 0;
      for (let i = 0; i < campIds.length; i += 50) {
        const batch = campIds.slice(i, i + 50);
        const resp = await get('/v1.3/report/integrated/get/', {
          advertiser_id: acc.id, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
          dimensions: JSON.stringify(['campaign_id']),
          metrics: JSON.stringify(['spend']),
          start_date: reportStart, end_date: reportEnd,
          filtering: JSON.stringify([{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify(batch) }]),
          page_size: '100',
        });
        for (const r of resp.data?.list || []) {
          totalSpend += parseFloat(r.metrics?.spend || '0');
        }
      }

      // video_idはユニークなものを取得（同じ動画の場合最初のものを使用）
      const uniqueVideos = new Map<string, string>();
      for (const ad of ads) {
        if (ad.videoId && !uniqueVideos.has(ad.videoId)) {
          uniqueVideos.set(ad.videoId, ad.adName);
        }
      }

      const cpo = data.count > 0 ? totalSpend / data.count : Infinity;
      for (const [videoId, adName] of uniqueVideos) {
        videoInfos.push({
          lpCr, videoId, adName, accountName: acc.name, accId: acc.id,
          appeal: data.appeal, totalSpend, indResCount: data.count, cpo,
        });
      }
    }
  }

  // 3. ランキング表示
  // LP-CR単位でユニーク化（複数アカウントに同じLP-CRがある場合は最もCV多いもの）
  const byLpCr = new Map<string, VideoInfo[]>();
  for (const v of videoInfos) {
    if (!byLpCr.has(v.lpCr)) byLpCr.set(v.lpCr, []);
    byLpCr.get(v.lpCr)!.push(v);
  }

  console.log('\n' + '='.repeat(80));
  console.log('個別予約が取れている動画ランキング（30日間、個別予約数順）');
  console.log('='.repeat(80));

  const ranked = [...byLpCr.entries()]
    .map(([lpCr, infos]) => {
      const totalRes = infos[0].indResCount;
      const totalSpend = infos.reduce((s, i) => s + i.totalSpend, 0);
      const cpo = totalRes > 0 ? totalSpend / totalRes : Infinity;
      const kpi = KPI[infos[0].appeal] || Infinity;
      return { lpCr, infos, totalRes, totalSpend, cpo, kpi, appeal: infos[0].appeal };
    })
    .sort((a, b) => b.totalRes - a.totalRes);

  console.log('\n導線 | LP-CR | 予約数 | 広告費 | CPO | KPI比 | 動画ID | 広告名');
  for (const r of ranked) {
    const kpiRatio = r.cpo < Infinity ? `${(r.cpo / r.kpi * 100).toFixed(0)}%` : '-';
    const status = r.cpo <= r.kpi ? '✅' : (r.cpo < Infinity ? '❌' : '?');
    // video_idはユニークなものだけ
    const uniqueVids = [...new Set(r.infos.map(i => i.videoId))];
    const accounts = [...new Set(r.infos.map(i => i.accountName))].join('/');
    console.log(`\n${status} ${r.appeal} | ${r.lpCr} | ${r.totalRes}件 | ¥${Math.round(r.totalSpend).toLocaleString()} | CPO ¥${r.cpo < Infinity ? Math.round(r.cpo).toLocaleString() : '-'} | ${kpiRatio} | ${accounts}`);
    for (const v of uniqueVids.slice(0, 3)) {
      const info = r.infos.find(i => i.videoId === v);
      console.log(`  video: ${v}`);
      console.log(`  ${info?.adName || '?'}`);
    }
  }

  // 4. キャンペーンIDテスト向け推奨
  console.log('\n' + '='.repeat(80));
  console.log('キャンペーンIDテスト向け推奨動画');
  console.log('='.repeat(80));

  const kpiPassed = ranked.filter(r => r.cpo <= r.kpi && r.totalRes >= 2);
  console.log(`\nKPI達成 & 予約2件以上: ${kpiPassed.length}件`);
  for (const r of kpiPassed) {
    const uniqueVids = [...new Set(r.infos.map(i => i.videoId))];
    console.log(`\n  ${r.appeal} ${r.lpCr}: ${r.totalRes}件予約 CPO ¥${Math.round(r.cpo).toLocaleString()} (KPI${(r.cpo / r.kpi * 100).toFixed(0)}%)`);
    for (const v of uniqueVids) {
      console.log(`    video: ${v}`);
    }
  }
}

main().catch(console.error);
